# SPDX-License-Identifier: Apache-2.0
"""Workbench bridge: drives Claude Code and the game import on the CLI host.

The ``claude`` CLI, node and the skill's tooling live on the DSW notebook, not
on the GPU pod, so this service runs there. The pod's ``/ext/workbench/``
proxy forwards ``/api/*`` here with a shared token; FLUX rendering stays on the
pod and the bridge only records its results.

    EDEN_WORKBENCH_TOKEN=... python -m eden.apps.workbench.bridge --host localhost --port 8091

Jobs are serialized: one Claude run at a time. Job state lives in memory and
in ``<state>/jobs/<id>.json`` so a page reload can pick a job back up.
"""

from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import shutil
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from aiohttp import web
from loguru import logger

from eden.apps.game2v.import_game import (
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

    def start(self, kind: str, slug: str, work: Callable[[Job], Awaitable[dict[str, Any]]]) -> Job:
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

    def start_game(self, request: str, slug: str) -> Job:
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

        return self.start("game", slug, work)

    def _import(self, project: Path, slug: str) -> dict[str, Any]:
        try:
            entry = import_game(project, slug, root=self.root, replace=True, capture=self.capture)
        except GameImportError as error:
            if "has not passed acceptance" not in str(error):
                raise
            entry = import_game(project, slug, root=self.root, replace=True, capture=self.capture, allow_incomplete=True)
        # The greybox capture is the coarse input for step 2; keep it beside the
        # cover, which step 2 replaces with the fine frame.
        shutil.copyfile(self.root / slug / entry["cover"], self.root / slug / COARSE)
        return entry

    # ---- step 2: caption + accept ------------------------------------

    def game_dir(self, slug: str) -> Path:
        if not _SLUG.fullmatch(slug) or not (self.root / slug / COARSE).is_file():
            raise web.HTTPNotFound(reason=f"{slug!r} has no workbench first frame yet.")
        return self.root / slug

    def start_caption(self, slug: str) -> Job:
        directory = self.game_dir(slug)

        async def work(job: Job) -> dict[str, Any]:
            caption = ""
            for attempt in range(2):
                result = await self._claude(
                    job, prompts.caption_prompt(directory / COARSE), cwd=directory,
                    timeout_s=CAPTION_TIMEOUT_S, unattended=False, add_dirs=[], allowed_tools=("Read",),
                )
                if not result.ok:
                    raise RuntimeError(result.error or "Claude did not caption the frame.")
                caption = prompts.sanitize_caption(result.text)
                if len(caption.split()) >= 20:
                    break
                self._line(job, f"caption too short ({len(caption.split())} words), retry {attempt + 1}")
            (directory / CAPTION).write_text(caption + "\n", encoding="utf-8")
            return {"caption": caption}

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
        return {"slug": slug, "coarse": COARSE, "caption": caption, "fines": fines}


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
        # Errors go back as JSON so the pod proxy can pass the reason through.
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
        return web.json_response(bench.start_caption(request.match_info["slug"]).public(), status=202)

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
