# SPDX-License-Identifier: Apache-2.0
"""Workbench bridge: drives Claude Code and the game import on the CLI host.

The ``claude`` CLI, node and the skill's tooling need not live on the GPU
host, so this service runs wherever they are. The model app's
``/ext/workbench/`` proxy forwards ``/api/*`` here with a shared token; FLUX
rendering stays on the GPU host and the bridge only records its results.

A conversation is the unit the page works in: its first message builds a game,
and every later one revises that same game in place.

    EDEN_WORKBENCH_TOKEN=... python -m eden.apps.workbench.bridge --host <bind-ip> --port 8091

Jobs are serialized: one Claude run at a time. Job state lives in memory and
in ``<state>/jobs/<id>.json`` so a page reload can pick a job back up.
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from aiohttp import web
from loguru import logger

from eden.apps.game2v.import_game import (
    _RESERVED_SLUGS,
    _SLUG,
    GameImportError,
    capture_cover,
    games_root,
    import_game,
)

from . import prompts
from .agent import Agent, AgentResult, claude_command

REALTIME = Path(__file__).resolve().parents[4]
SKILL = REALTIME / "skills" / "game-prototype-turbo"
GAME_TIMEOUT_S = float(os.environ.get("EDEN_WORKBENCH_GAME_TIMEOUT_S", 3 * 3600))
CAPTION_TIMEOUT_S = 300.0
TOKEN_HEADER = "X-Workbench-Token"
COARSE = "coarse.png"
CAPTION = "caption.txt"
_LOG_LIMIT = 2000
# Messages of a conversation handed back to Claude with a revision request.
_HISTORY_LIMIT = 20
_CONVERSATION_ID = re.compile(r"^[0-9a-f]{12}$")
_RUN_LINE = re.compile(r"^\s*RUN:\s*(\S+)\s*$", re.MULTILINE)


@dataclass
class Job:
    id: str
    kind: str
    slug: str
    status: str = "running"  # running | succeeded | failed | cancelled
    created: float = field(default_factory=time.time)
    finished: float | None = None
    log: list[str] = field(default_factory=list)
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def public(self, since: int = 0) -> dict[str, Any]:
        body = asdict(self)
        body["log"] = self.log[since:]
        body["log_offset"] = since
        body["log_total"] = len(self.log)
        return body


class Workbench:
    def __init__(self, *, state: Path, root: Path, skill: Path = SKILL, capture=capture_cover) -> None:
        self.state = state
        self.root = root
        self.skill = skill
        self.capture = capture
        self.jobs: dict[str, Job] = {}
        self._agents: dict[str, Agent] = {}
        self._claude_lock = asyncio.Lock()
        (state / "jobs").mkdir(parents=True, exist_ok=True)
        (state / "projects").mkdir(parents=True, exist_ok=True)
        (state / "conversations").mkdir(parents=True, exist_ok=True)

    # ---- jobs ---------------------------------------------------------

    def _save(self, job: Job) -> None:
        path = self.state / "jobs" / f"{job.id}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(asdict(job), ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)

    def _line(self, job: Job, text: str) -> None:
        job.log.append(f"{time.strftime('%H:%M:%S')} {text}")
        if len(job.log) > _LOG_LIMIT:
            del job.log[: len(job.log) - _LOG_LIMIT]
        self._save(job)

    def busy(self) -> Job | None:
        return next((job for job in self.jobs.values() if job.status == "running"), None)

    def start(self, kind: str, slug: str, work: Callable[[Job], Awaitable[dict[str, Any]]],
              on_done: Callable[[Job], None] | None = None) -> Job:
        running = self.busy()
        if running is not None:
            raise web.HTTPConflict(reason=f"Job {running.id} ({running.kind} {running.slug}) is still running.")
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, slug=slug)
        self.jobs[job.id] = job
        self._save(job)

        async def runner() -> None:
            try:
                job.result = await work(job)
                job.status = "succeeded"
            except asyncio.CancelledError:
                job.status = "cancelled"
            except Exception as error:  # reported on the job, not the request
                logger.opt(exception=True).warning("Workbench job {} failed.", job.id)
                job.status = "cancelled" if self._cancelled(job) else "failed"
                job.error = str(error)
            finally:
                job.finished = time.time()
                self._agents.pop(job.id, None)
                self._line(job, f"job {job.status}")
                if on_done is not None:
                    try:
                        on_done(job)
                    except Exception:
                        logger.opt(exception=True).warning("Workbench job {} callback failed.", job.id)

        asyncio.get_running_loop().create_task(runner())
        return job

    def _cancelled(self, job: Job) -> bool:
        agent = self._agents.get(job.id)
        return bool(agent and agent.cancelled)

    def cancel(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise web.HTTPNotFound(reason=f"Unknown job {job_id}")
        agent = self._agents.get(job_id)
        if agent is not None:
            agent.cancel()
        return job

    async def _claude(self, job: Job, prompt: str, *, cwd: Path, timeout_s: float, unattended: bool,
                      add_dirs: list[Path], allowed_tools: tuple[str, ...] = ()) -> AgentResult:
        env = dict(os.environ)
        # Root on a sandboxed notebook: claude refuses skip-permissions otherwise.
        env.setdefault("IS_SANDBOX", "1")
        command = claude_command(add_dirs=add_dirs, unattended=unattended, allowed_tools=allowed_tools)
        agent = Agent(command, prompt, cwd=cwd, env=env, on_line=lambda text: self._line(job, text))
        self._agents[job.id] = agent
        async with self._claude_lock:
            result = await agent.run(timeout_s)
        if result.cost_usd is not None:
            self._line(job, f"cost ${result.cost_usd:.2f}")
        return result

    # ---- step 1: game -------------------------------------------------

    def start_game(self, request: str, slug: str, on_done: Callable[[Job], None] | None = None) -> Job:
        if not request.strip():
            raise web.HTTPBadRequest(reason="Describe the game first.")
        if not _SLUG.fullmatch(slug):
            raise web.HTTPBadRequest(reason="Slug must be lowercase words joined by '-'.")
        project = self.state / "projects" / slug
        if (self.root / slug).exists() and not (project / ".workbench").is_file():
            raise web.HTTPConflict(reason=f"{slug!r} already exists and was not made by the workbench.")

        async def work(job: Job) -> dict[str, Any]:
            if project.exists():
                shutil.rmtree(project)
            project.mkdir(parents=True)
            self._line(job, f"project {project}")
            result = await self._claude(
                job, prompts.game_prompt(request, skill=self.skill, project=project),
                cwd=project, timeout_s=GAME_TIMEOUT_S, unattended=True, add_dirs=[self.skill],
            )
            if not result.ok:
                raise RuntimeError(result.error or "Claude did not finish the game.")
            self._line(job, "import into games/ and capture the greybox first frame")
            (project / ".workbench").write_text(json.dumps({"request": request}), encoding="utf-8")
            entry = await asyncio.to_thread(self._import, project, slug)
            return {"summary": result.text, "entry": entry, "coarse": COARSE}

        return self.start("game", slug, work, on_done)

    def start_revision(self, slug: str, request: str, history: list[tuple[str, str]],
                       on_done: Callable[[Job], None] | None = None) -> Job:
        """Change a game the workbench made, in place, and import the result."""
        if not request.strip():
            raise web.HTTPBadRequest(reason="Describe the change first.")
        project = self.state / "projects" / slug
        if not _SLUG.fullmatch(slug) or not (project / ".workbench").is_file():
            raise web.HTTPConflict(reason=f"{slug!r} was not made by the workbench, so it cannot be revised here.")

        async def work(job: Job) -> dict[str, Any]:
            result = await self._claude(
                job, prompts.revise_prompt(request, history, skill=self.skill, project=project),
                cwd=project, timeout_s=GAME_TIMEOUT_S, unattended=True, add_dirs=[self.skill],
            )
            if not result.ok:
                raise RuntimeError(result.error or "Claude did not finish the change.")
            run = _revised_run(project, result.text)
            self._line(job, f"import {run.relative_to(project).as_posix()} and capture the greybox first frame")
            entry = await asyncio.to_thread(self._import, project, slug, run)
            summary = _RUN_LINE.sub("", result.text).strip()
            return {"summary": summary, "entry": entry, "coarse": COARSE, "run": run.relative_to(project).as_posix()}

        return self.start("revision", slug, work, on_done)

    def _import(self, project: Path, slug: str, run: Path | None = None) -> dict[str, Any]:
        # The import replaces games/<slug>/ wholesale. The caption and the fine
        # renders belong to the workbench, not the game, so they survive it.
        keep = Path(tempfile.mkdtemp(prefix=f".{slug}-keep-", dir=self.state))
        directory = self.root / slug
        try:
            if directory.is_dir():
                for path in [directory / CAPTION, *directory.glob("fine_*.png")]:
                    if path.is_file():
                        shutil.copy2(path, keep / path.name)
            if run is not None:
                entry = import_game(project, slug, root=self.root, replace=True, capture=self.capture, run=run)
            else:
                try:
                    entry = import_game(project, slug, root=self.root, replace=True, capture=self.capture)
                except GameImportError as error:
                    if "has not passed acceptance" not in str(error):
                        raise
                    entry = import_game(project, slug, root=self.root, replace=True, capture=self.capture,
                                        allow_incomplete=True)
            for path in keep.iterdir():
                if not (directory / path.name).exists():
                    shutil.copy2(path, directory / path.name)
        finally:
            shutil.rmtree(keep, ignore_errors=True)
        # The greybox capture is the coarse input for step 2; keep it beside the
        # cover, which step 2 replaces with the fine frame.
        shutil.copyfile(directory / entry["cover"], directory / COARSE)
        return entry

    # ---- step 2: caption + accept ------------------------------------

    def game_dir(self, slug: str) -> Path:
        if not _SLUG.fullmatch(slug) or not (self.root / slug / COARSE).is_file():
            raise web.HTTPNotFound(reason=f"{slug!r} has no workbench first frame yet.")
        return self.root / slug

    def start_caption(self, slug: str, style: str = "realistic") -> Job:
        if style not in prompts.CAPTION_STYLES:
            raise web.HTTPBadRequest(reason="Unknown caption style.")
        directory = self.game_dir(slug)

        async def work(job: Job) -> dict[str, Any]:
            caption = ""
            for attempt in range(2):
                result = await self._claude(
                    job, prompts.caption_prompt(directory / COARSE, style), cwd=directory,
                    timeout_s=CAPTION_TIMEOUT_S, unattended=False, add_dirs=[], allowed_tools=("Read",),
                )
                if not result.ok:
                    raise RuntimeError(result.error or "Claude did not caption the frame.")
                caption = prompts.sanitize_caption(result.text, style)
                scene_words = len(caption.split(" Visual style:", 1)[0].split())
                if scene_words >= 20:
                    break
                self._line(job, f"scene caption too short ({scene_words} words), retry {attempt + 1}")
            if scene_words < 20:
                raise RuntimeError("Claude did not describe enough of the greybox frame. Try generating the caption again.")
            (directory / CAPTION).write_text(caption + "\n", encoding="utf-8")
            return {"caption": caption, "style": style}

        return self.start("caption", slug, work)

    def accept(self, slug: str, image: str, caption: str) -> dict[str, Any]:
        directory = self.game_dir(slug)
        source = (directory / image).resolve()
        if not source.is_relative_to(directory) or source.suffix != ".png" or not source.is_file():
            raise web.HTTPBadRequest(reason=f"No such rendered image: {image}")
        registry_path = self.root / "registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        entry = next((game for game in registry["games"] if game.get("slug") == slug), None)
        if entry is None:
            raise web.HTTPNotFound(reason=f"{slug!r} is not registered.")
        shutil.copyfile(source, directory / "cover.png")
        entry["cover"] = "cover.png"
        if caption.strip():
            entry["cover_prompt"] = caption.strip()
        temporary = registry_path.with_name(f".registry-{os.getpid()}.json")
        temporary.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(registry_path)
        return {"slug": slug, "cover": "cover.png", "source": image}

    def files(self, slug: str) -> dict[str, Any]:
        directory = self.game_dir(slug)
        caption = (directory / CAPTION).read_text(encoding="utf-8").strip() if (directory / CAPTION).is_file() else ""
        fines = sorted(path.name for path in directory.glob("fine_*.png"))
        # A fine frame older than the greybox it was rendered from predates the
        # game's latest change, so the cover may no longer match the scene.
        coarse = directory / COARSE
        coarse_time = coarse.stat().st_mtime
        cover = directory / "cover.png"
        return {"slug": slug, "coarse": COARSE, "caption": caption, "fines": fines,
                "fines_stale": [name for name in fines if (directory / name).stat().st_mtime < coarse_time],
                "cover_is_greybox": cover.is_file() and cover.read_bytes() == coarse.read_bytes()}

    # ---- conversations ------------------------------------------------

    def _conversation_path(self, conversation_id: str) -> Path:
        if not _CONVERSATION_ID.fullmatch(conversation_id):
            raise web.HTTPNotFound(reason="Unknown conversation.")
        return self.state / "conversations" / f"{conversation_id}.json"

    def conversation(self, conversation_id: str) -> dict[str, Any]:
        path = self._conversation_path(conversation_id)
        if not path.is_file():
            raise web.HTTPNotFound(reason="Unknown conversation.")
        return json.loads(path.read_text(encoding="utf-8"))

    def _save_conversation(self, conversation: dict[str, Any]) -> None:
        conversation["updated"] = time.time()
        path = self._conversation_path(conversation["id"])
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(conversation, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)

    def conversations(self) -> list[dict[str, Any]]:
        rows = []
        for path in (self.state / "conversations").glob("*.json"):
            try:
                body = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            row = {key: body.get(key) for key in ("id", "slug", "title", "created", "updated")}
            messages = body.get("messages") or []
            # Enough for the gallery to list a conversation whose game is not
            # built yet: what was asked, and how the latest turn went.
            first = next((m for m in messages if m.get("role") == "user"), None)
            last = next((m for m in reversed(messages) if m.get("role") == "assistant"), None)
            row["count"] = len(messages)
            row["preview"] = (first or {}).get("text", "")[:120]
            row["status"] = (last or {}).get("status")
            rows.append(row)
        return sorted(rows, key=lambda row: row.get("updated") or 0, reverse=True)

    def new_conversation(self) -> dict[str, Any]:
        now = time.time()
        conversation = {"id": uuid.uuid4().hex[:12], "slug": None, "title": "", "created": now,
                        "updated": now, "messages": []}
        self._save_conversation(conversation)
        return conversation

    def _has_game(self, slug: str | None) -> bool:
        if not slug:
            return False
        return (self.state / "projects" / slug / ".workbench").is_file() and (self.root / slug).is_dir()

    def _new_slug(self, text: str) -> str:
        words = re.findall(r"[a-z0-9]+", text.lower())[:4]
        base = "-".join(words) or "game"
        if base in _RESERVED_SLUGS:
            base = f"{base}-game"
        taken = {row.get("slug") for row in self.conversations()}
        slug, number = base, 2
        while slug in taken or (self.root / slug).exists() or (self.state / "projects" / slug).exists():
            slug, number = f"{base}-{number}", number + 1
        return slug

    def post_message(self, conversation_id: str, text: str) -> dict[str, Any]:
        """Record a user message and start the job that answers it.

        The first message of a conversation builds a game; every later one
        revises it. A build that failed is retried from all the requests so
        far, so the conversation never points at a game that does not exist.
        """
        conversation = self.conversation(conversation_id)
        text = text.strip()
        if not text:
            raise web.HTTPBadRequest(reason="Write a message first.")
        running = self.busy()
        if running is not None:
            raise web.HTTPConflict(reason=f"Job {running.id} ({running.kind} {running.slug}) is still running.")
        history = [(m["role"], m["text"]) for m in conversation["messages"] if m.get("text")][-_HISTORY_LIMIT:]
        now = time.time()

        def on_done(job: Job) -> None:
            current = self.conversation(conversation_id)
            for message in current["messages"]:
                if message.get("job") == job.id:
                    message["status"] = job.status
                    message["text"] = str(job.result.get("summary") or "") if job.status == "succeeded" else ""
                    message["error"] = job.error
                    message["time"] = time.time()
                    # The live log lives on the job and dies with the process;
                    # the conversation keeps it so a reopened chat still shows
                    # what Claude did and which stage it reached.
                    message["log"] = list(job.log)
            entry = job.result.get("entry") if job.status == "succeeded" else None
            if isinstance(entry, dict) and entry.get("title"):
                current["title"] = str(entry["title"])
            self._save_conversation(current)

        if self._has_game(conversation.get("slug")):
            job = self.start_revision(conversation["slug"], text, history, on_done)
        else:
            slug = conversation.get("slug") or self._new_slug(text)
            requests = [m["text"] for m in conversation["messages"] if m["role"] == "user"] + [text]
            job = self.start_game("\n\n".join(requests), slug, on_done)
            conversation["slug"] = slug
        if not conversation.get("title"):
            conversation["title"] = " ".join(text.split())[:40]
        conversation["messages"] += [
            {"role": "user", "text": text, "time": now},
            {"role": "assistant", "text": "", "job": job.id, "kind": job.kind, "status": "running", "time": now},
        ]
        self._save_conversation(conversation)
        return {"conversation": conversation, "job": job.public()}


def _revised_run(project: Path, text: str) -> Path:
    """The run a revision produced: the one Claude named, else the newest."""
    match = _RUN_LINE.search(text)
    if match:
        run = (project / match.group(1).strip("`'\"")).resolve()
        if run.is_relative_to(project) and (run / "index.html").is_file():
            return run
    runs = [path.parent for path in project.glob("runs/*/*/index.html")]
    if not runs:
        raise RuntimeError(f"{project} has no runnable run after the change.")
    return max(runs, key=lambda run: (run / "index.html").stat().st_mtime).resolve()


def _check_token(request: web.Request) -> None:
    expected = os.environ.get("EDEN_WORKBENCH_TOKEN", "")
    if not expected or not hmac.compare_digest(request.headers.get(TOKEN_HEADER, ""), expected):
        raise web.HTTPUnauthorized(reason="Bad workbench token.")


async def _body(request: web.Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except json.JSONDecodeError as error:
        raise web.HTTPBadRequest(reason="Expected a JSON object.") from error
    if not isinstance(payload, dict):
        raise web.HTTPBadRequest(reason="Expected a JSON object.")
    return payload


def make_app(bench: Workbench) -> web.Application:
    @web.middleware
    async def auth(request: web.Request, handler):
        # Errors go back as JSON so the app proxy can pass the reason through.
        try:
            _check_token(request)
            return await handler(request)
        except web.HTTPException as error:
            if error.status < 400:
                raise
            return web.json_response({"error": error.reason}, status=error.status)

    app = web.Application(middlewares=[auth])
    routes = web.RouteTableDef()

    @routes.get("/api/state")
    async def state(_: web.Request) -> web.Response:
        running = bench.busy()
        recent = sorted(bench.jobs.values(), key=lambda job: job.created)[-10:]
        return web.json_response({
            "running": running.public() if running else None,
            "jobs": [{"id": j.id, "kind": j.kind, "slug": j.slug, "status": j.status} for j in recent],
        })

    @routes.post("/api/games")
    async def create_game(request: web.Request) -> web.Response:
        payload = await _body(request)
        job = bench.start_game(str(payload.get("prompt", "")), str(payload.get("slug", "")))
        return web.json_response(job.public(), status=202)

    @routes.get("/api/conversations")
    async def list_conversations(_: web.Request) -> web.Response:
        return web.json_response({"conversations": bench.conversations()})

    @routes.post("/api/conversations")
    async def create_conversation(_: web.Request) -> web.Response:
        return web.json_response(bench.new_conversation(), status=201)

    @routes.get("/api/conversations/{id}")
    async def get_conversation(request: web.Request) -> web.Response:
        return web.json_response(bench.conversation(request.match_info["id"]))

    @routes.post("/api/conversations/{id}/messages")
    async def post_message(request: web.Request) -> web.Response:
        payload = await _body(request)
        return web.json_response(bench.post_message(request.match_info["id"], str(payload.get("text", ""))), status=202)

    @routes.get("/api/jobs/{id}")
    async def get_job(request: web.Request) -> web.Response:
        job = bench.jobs.get(request.match_info["id"])
        if job is None:
            raise web.HTTPNotFound(reason="Unknown job.")
        since = max(0, int(request.query.get("since", "0") or 0))
        return web.json_response(job.public(since))

    @routes.post("/api/jobs/{id}/cancel")
    async def cancel_job(request: web.Request) -> web.Response:
        return web.json_response(bench.cancel(request.match_info["id"]).public())

    @routes.get("/api/games/{slug}")
    async def game_files(request: web.Request) -> web.Response:
        return web.json_response(bench.files(request.match_info["slug"]))

    @routes.post("/api/games/{slug}/caption")
    async def caption(request: web.Request) -> web.Response:
        payload = await _body(request) if request.content_length else {}
        style = str(payload.get("style", "realistic"))
        return web.json_response(bench.start_caption(request.match_info["slug"], style).public(), status=202)

    @routes.post("/api/games/{slug}/accept")
    async def accept(request: web.Request) -> web.Response:
        payload = await _body(request)
        return web.json_response(bench.accept(
            request.match_info["slug"], str(payload.get("image", "")), str(payload.get("caption", "")),
        ))

    app.add_routes(routes)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--state", type=Path, default=REALTIME / ".workbench")
    args = parser.parse_args()
    if not os.environ.get("EDEN_WORKBENCH_TOKEN"):
        raise SystemExit("Set EDEN_WORKBENCH_TOKEN; the bridge refuses unauthenticated requests.")
    bench = Workbench(state=args.state.resolve(), root=games_root())
    web.run_app(make_app(bench), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
