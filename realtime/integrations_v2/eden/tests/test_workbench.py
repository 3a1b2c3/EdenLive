# SPDX-License-Identifier: Apache-2.0
"""CPU tests for the workbench bridge, pod proxy and FLUX worker shell."""

from __future__ import annotations

import asyncio
import json
import os
import stat
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from eden.apps.workbench import bridge as bridge_mod
from eden.apps.workbench import flux_worker
from eden.apps.workbench.agent import summarize

TOKEN = "test-token"

_FAKE_CLAUDE = r'''#!/usr/bin/env python3
"""Stand-in for `claude -p`: writes a tiny accepted project, or a caption."""
import json, os, sys
from pathlib import Path
prompt = sys.stdin.read()
if os.environ.get("FAKE_PROMPT_FILE"):
    Path(os.environ["FAKE_PROMPT_FILE"]).write_text(prompt)
def emit(event): print(json.dumps(event), flush=True)
if not prompt.strip():
    print("Error: Input must be provided either through stdin or as a prompt argument when using --print")
    sys.exit(1)
# Real claude treats --add-dir/--allowedTools as variadic; a trailing
# positional would be swallowed, so the bridge must not pass one.
if sys.argv[-1] not in ("--verbose", "--dangerously-skip-permissions") and sys.argv[-2] not in ("--add-dir", "--allowedTools"):
    print("Error: unexpected positional argument"); sys.exit(1)
emit({"type": "system", "subtype": "init"})
if os.environ.get("FAKE_CLAUDE_FAIL"):
    emit({"type": "result", "subtype": "error_during_execution", "is_error": True, "result": ""})
    sys.exit(1)
if "Change a passed game" in prompt:
    root = Path.cwd()
    run = root / "runs" / "step3" / "r2"
    run.mkdir(parents=True)
    (run / "index.html").write_text("<html><head></head><body>revised</body></html>")
    (run / "run.json").write_text(json.dumps({"controls": ["WASD move"], "modules": []}))
    emit({"type": "result", "subtype": "success", "is_error": False,
          "result": "RUN: runs/step3/r2\nMade the yard bigger.", "duration_ms": 1000})
elif "GamePrototypeTurbo" in prompt:
    root = Path.cwd()
    run = root / "runs" / "step3" / "r1"
    run.mkdir(parents=True)
    (run / "index.html").write_text("<html><head></head><body></body></html>")
    (run / "run.json").write_text(json.dumps({"controls": ["WASD move"], "modules": []}))
    (root / "brief.json").write_text(json.dumps({"title": "Tiny", "scene": {"description": "A tiny test yard."}}))
    (root / "package.json").write_text(json.dumps({"dependencies": {"three": os.environ["FAKE_THREE"]}}))
    (root / ".state.json").write_text(json.dumps({"current_stage": "done", "stages": {
        "acceptance": {"status": "passed", "artifact": "runs/step3/r1", "evidence": [], "loop_count": 0}}}))
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "python forge/finish.py --check"}}]}})
    emit({"type": "result", "subtype": "success", "is_error": False, "result": "Built Tiny.", "total_cost_usd": 0.5, "duration_ms": 1000})
else:
    words = os.environ.get("FAKE_CAPTION", "A small courtyard " * 8)
    emit({"type": "result", "subtype": "success", "is_error": False, "result": words, "duration_ms": 10})
'''


@pytest.fixture
def fake_claude(tmp_path, monkeypatch):
    script = tmp_path / "claude"
    script.write_text(_FAKE_CLAUDE)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr("eden.apps.workbench.agent.CLAUDE", str(script))
    monkeypatch.setenv("EDEN_WORKBENCH_TOKEN", TOKEN)
    from eden.apps.game2v.import_game import THREE_VERSION

    monkeypatch.setenv("FAKE_THREE", THREE_VERSION)
    return script


def _fake_capture(slug: str, path: Path, root: Path) -> None:
    Image.new("RGB", (64, 36), (120, 40, 200)).save(path)


# The coarse-to-fine rules are now vendored in flux_c2f_rules.py.  Tests that
# need to override them monkeypatch the module-level names the workbench reads.
@pytest.fixture
def flux_skill(tmp_path, monkeypatch):
    """Override the vendored c2f rules with test stand-ins."""
    monkeypatch.setattr(
        "eden.apps.workbench.prompts.IMAGE_INSTRUCTIONS",
        "Describe the scene plainly.",
    )
    monkeypatch.setattr(
        "eden.apps.workbench.prompts._sanitize",
        lambda caption: " ".join(
            w for w in caption.split() if w.lower() not in {"red", "rendered"}
        ),
    )
    monkeypatch.setattr(
        "eden.apps.workbench.flux_worker.EDIT_INSTRUCTION",
        "Make it photoreal.",
    )
    yield


@pytest.fixture
def games(tmp_path):
    root = tmp_path / "games"
    root.mkdir()
    (root / "registry.json").write_text(json.dumps({"games": []}))
    return root


async def _wait(client: TestClient, job_id: str) -> dict:
    for _ in range(200):
        response = await client.get(f"/api/jobs/{job_id}", headers={"X-Workbench-Token": TOKEN})
        body = await response.json()
        if body["status"] != "running":
            return body
        await asyncio.sleep(0.05)
    raise AssertionError("job did not finish")


def _run(coro):
    return asyncio.run(coro)


def test_summarize_tool_and_text_lines():
    lines = summarize({"type": "assistant", "message": {"content": [
        {"type": "text", "text": "Starting\nintake"},
        {"type": "tool_use", "name": "Read", "input": {"file_path": "/x/SKILL.md"}},
    ]}})
    assert lines == ["say  Starting intake", "tool Read: /x/SKILL.md"]


def test_bridge_rejects_missing_token(games, tmp_path, fake_claude):
    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            response = await client.get("/api/state")
            assert response.status == 401
            assert "token" in (await response.json())["error"]
    _run(body())


def test_game_job_imports_and_keeps_coarse_frame(games, tmp_path, fake_claude):
    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        headers = {"X-Workbench-Token": TOKEN}
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            response = await client.post("/api/games", json={"prompt": "a tiny yard game", "slug": "tiny-yard"}, headers=headers)
            assert response.status == 202
            job = await _wait(client, (await response.json())["id"])
            assert job["status"] == "succeeded", job
            assert any("finish.py" in line for line in job["log"])
            registry = json.loads((games / "registry.json").read_text())
            assert [g["slug"] for g in registry["games"]] == ["tiny-yard"]
            assert (games / "tiny-yard" / "coarse.png").is_file()
            assert (games / "tiny-yard" / "cover.png").is_file()

            # A second game request while idle works; a concurrent one is refused.
            first = await client.post("/api/games", json={"prompt": "again", "slug": "tiny-yard"}, headers=headers)
            second = await client.post("/api/games", json={"prompt": "again", "slug": "other"}, headers=headers)
            assert first.status == 202 and second.status == 409
            await _wait(client, (await first.json())["id"])
    _run(body())


def test_game_job_reports_claude_failure(games, tmp_path, fake_claude, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_FAIL", "1")

    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            response = await client.post("/api/games", json={"prompt": "x", "slug": "broken"}, headers={"X-Workbench-Token": TOKEN})
            job = await _wait(client, (await response.json())["id"])
            assert job["status"] == "failed"
            assert json.loads((games / "registry.json").read_text())["games"] == []
    _run(body())


def test_caption_is_sanitized_and_accept_replaces_cover(games, tmp_path, fake_claude, flux_skill, monkeypatch):
    monkeypatch.setenv("FAKE_CAPTION", "A small courtyard with a bright red pillar and rendered tiles " * 3)

    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        headers = {"X-Workbench-Token": TOKEN}
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            job = await _wait(client, (await (await client.post("/api/games", json={"prompt": "yard", "slug": "yard"}, headers=headers)).json())["id"])
            assert job["status"] == "succeeded"

            job = await _wait(client, (await (await client.post("/api/games/yard/caption", headers=headers)).json())["id"])
            assert job["status"] == "succeeded", job
            caption = job["result"]["caption"]
            assert "red" not in caption.split() and "rendered" not in caption.split()
            assert (games / "yard" / "caption.txt").read_text().strip() == caption

            Image.new("RGB", (64, 36), (1, 2, 3)).save(games / "yard" / "fine_7.png")
            bad = await client.post("/api/games/yard/accept", json={"image": "../registry.json"}, headers=headers)
            assert bad.status == 400
            ok = await client.post("/api/games/yard/accept", json={"image": "fine_7.png", "caption": caption}, headers=headers)
            assert ok.status == 200
            assert Image.open(games / "yard" / "cover.png").getpixel((0, 0)) == (1, 2, 3)
            entry = json.loads((games / "registry.json").read_text())["games"][0]
            assert entry["cover_prompt"] == caption
            files = await (await client.get("/api/games/yard", headers=headers)).json()
            assert files["fines"] == ["fine_7.png"] and files["caption"] == caption
    _run(body())


def test_caption_style_reaches_claude_and_render_prompt(games, tmp_path, fake_claude, monkeypatch):
    prompt_file = tmp_path / "claude-prompt.txt"
    monkeypatch.setenv("FAKE_PROMPT_FILE", str(prompt_file))
    monkeypatch.setenv("FAKE_CAPTION", (
        "SCENE: A red box stands beside a marker near the center of a courtyard. "
        "A route passes between the two objects and continues toward a boundary in the background. "
        "Several fixtures line the far side of the route, while an open area occupies the foreground. "
        "The camera faces the route and the objects remain separated.\n"
        "STYLE: Give the courtyard clean anime linework, blue cel shading and crisp highlights.\n"
        "Do not include this extra explanation."
    ))

    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        headers = {"X-Workbench-Token": TOKEN}
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            game = await client.post("/api/games", json={"prompt": "yard", "slug": "yard"}, headers=headers)
            assert (await _wait(client, (await game.json())["id"]))["status"] == "succeeded"
            bad = await client.post("/api/games/yard/caption", json={"style": "unknown"}, headers=headers)
            assert bad.status == 400
            response = await client.post("/api/games/yard/caption", json={"style": "anime"}, headers=headers)
            job = await _wait(client, (await response.json())["id"])
            assert job["status"] == "succeeded", job
            assert job["result"]["style"] == "anime"
            caption = job["result"]["caption"]
            scene, style = caption.split(" Visual style: ", 1)
            assert "red" not in scene.lower() and "container" in scene
            assert "anime linework" in style and "blue cel shading" in style
            assert "extra explanation" not in caption
            assert "Anime" in prompt_file.read_text() and "blue" not in prompt_file.read_text()
            assert "Visual style: " + style in flux_worker.build_prompt(caption)
            assert (games / "yard" / "caption.txt").read_text().strip() == caption

            monkeypatch.setenv("FAKE_CAPTION", "SCENE: A courtyard.\nSTYLE: " + "Colorful cinematic lighting. " * 20)
            short = await client.post("/api/games/yard/caption", json={"style": "cinematic"}, headers=headers)
            failed = await _wait(client, (await short.json())["id"])
            assert failed["status"] == "failed"
            assert "enough of the greybox" in failed["error"]
            assert (games / "yard" / "caption.txt").read_text().strip() == caption

    _run(body())


def test_flux_worker_validates_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("EDEN_GAMES_ROOT", str(tmp_path))
    coarse = tmp_path / "g" / "coarse.png"
    coarse.parent.mkdir()
    Image.new("RGB", (8, 8)).save(coarse)
    calls = []

    class FakeRenderer:
        def render(self, coarse, caption, seed, out):
            calls.append((coarse, caption, seed, out))
            return {"image": str(out), "seconds": 0.0, "peak_gb": 0.0}

    async def body():
        async with TestClient(TestServer(flux_worker.make_app(FakeRenderer))) as client:
            for _ in range(100):
                if (await (await client.get("/healthz")).json())["status"] == "ready":
                    break
                await asyncio.sleep(0.02)
            outside = await client.post("/render", json={"coarse": "/etc/passwd", "out": str(tmp_path / "g/x.png"), "caption": "c"})
            assert outside.status == 400
            ok = await client.post("/render", json={"coarse": str(coarse), "out": str(tmp_path / "g/fine_1.png"), "caption": "c", "seed": 1})
            assert ok.status == 200
    asyncio.run(body())
    assert calls and calls[0][2] == 1


def test_flux_prompt_uses_skill_instruction(flux_skill):
    assert flux_worker.build_prompt(" a yard ") == "Make it photoreal. Scene: a yard"


def test_vendored_c2f_rules_sanitize_like_the_skill():
    from eden.apps.workbench import flux_c2f_rules as rules

    assert "45 to 90 words" in rules.IMAGE_INSTRUCTIONS
    assert rules.EDIT_INSTRUCTION.startswith("Convert the coarse 3D proxy image")
    cleaned = rules.sanitize_caption("A red box beside a wooden sphere , and .")
    # "red" and "wooden" are forbidden, "box" → "container", "sphere" → "marker",
    # trailing ", and ." collapses to ",." then the comma-before-period is cleaned.
    assert cleaned == "A container beside a marker,."


def test_pod_proxy_forwards_token_and_serves_images(tmp_path, monkeypatch):
    from eden.apps.game2v import workbench_proxy

    seen = {}

    async def backend_state(request: web.Request) -> web.Response:
        seen["token"] = request.headers.get("X-Workbench-Token")
        seen["query"] = request.query_string
        return web.json_response({"running": None})

    backend = web.Application()
    backend.router.add_get("/api/state", backend_state)
    games = tmp_path / "games"
    (games / "yard").mkdir(parents=True)
    Image.new("RGB", (8, 8)).save(games / "yard" / "coarse.png")
    monkeypatch.setenv("EDEN_GAMES_ROOT", str(games))
    monkeypatch.setenv("EDEN_WORKBENCH_TOKEN", TOKEN)

    async def body():
        async with TestServer(backend) as upstream:
            monkeypatch.setenv("EDEN_WORKBENCH_BRIDGE", str(upstream.make_url("")).rstrip("/"))
            app = web.Application()
            app.router.add_route("*", "/ext/workbench/{tail:.*}", lambda r: workbench_proxy.handle_workbench(r, r.match_info["tail"]))
            async with TestClient(TestServer(app)) as client:
                response = await client.get("/ext/workbench/api/state?x=1")
                assert response.status == 200 and seen == {"token": TOKEN, "query": "x=1"}
                assert (await client.get("/ext/workbench/image/yard/coarse.png")).status == 200
                assert (await client.get("/ext/workbench/image/yard/registry.json")).status == 404
                assert (await client.get("/ext/workbench/image/..%2F/coarse.png")).status == 404
                script = await client.get("/ext/workbench/workbench.js")
                assert script.status == 200 and "Game2V workbench" in await script.text()
    asyncio.run(body())


def test_conversation_builds_then_revises_one_game(games, tmp_path, fake_claude, monkeypatch):
    captures = []

    def capture(slug, path, root):
        captures.append(slug)
        Image.new("RGB", (64, 36), (len(captures), 0, 0)).save(path)

    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=capture)
        headers = {"X-Workbench-Token": TOKEN}
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            created = await client.post("/api/conversations", headers=headers)
            assert created.status == 201
            conversation = await created.json()
            cid = conversation["id"]
            assert conversation["messages"] == [] and conversation["slug"] is None

            first = await client.post(f"/api/conversations/{cid}/messages",
                                      json={"text": "A tiny yard with crates"}, headers=headers)
            assert first.status == 202
            started = await first.json()
            slug = started["conversation"]["slug"]
            assert slug == "a-tiny-yard-with"
            # One job at a time, across conversations too.
            other = await (await client.post("/api/conversations", headers=headers)).json()
            busy = await client.post(f"/api/conversations/{other['id']}/messages", json={"text": "x"}, headers=headers)
            assert busy.status == 409
            job = await _wait(client, started["job"]["id"])
            assert job["status"] == "succeeded", job

            current = await (await client.get(f"/api/conversations/{cid}", headers=headers)).json()
            assert [m["role"] for m in current["messages"]] == ["user", "assistant"]
            assert current["messages"][1]["status"] == "succeeded"
            assert current["messages"][1]["text"] == "Built Tiny."
            assert current["title"] == "Tiny"

            # The caption and a fine render survive the re-import; the greybox is new.
            (games / slug / "caption.txt").write_text("kept caption\n")
            Image.new("RGB", (64, 36), (9, 9, 9)).save(games / slug / "fine_3.png")
            second = await client.post(f"/api/conversations/{cid}/messages",
                                       json={"text": "make the yard bigger"}, headers=headers)
            assert second.status == 202
            job = await _wait(client, (await second.json())["job"]["id"])
            assert job["status"] == "succeeded", job
            assert job["kind"] == "revision" and job["result"]["run"] == "runs/step3/r2"
            assert "revised" in (games / slug / "index.html").read_text()
            assert (games / slug / "caption.txt").read_text() == "kept caption\n"
            assert (games / slug / "fine_3.png").is_file()
            assert Image.open(games / slug / "coarse.png").getpixel((0, 0)) == (2, 0, 0)

            current = await (await client.get(f"/api/conversations/{cid}", headers=headers)).json()
            assert [m["role"] for m in current["messages"]] == ["user", "assistant"] * 2
            assert current["messages"][3]["text"] == "Made the yard bigger."
            assert current["slug"] == slug
            assert len(json.loads((games / "registry.json").read_text())["games"]) == 1

            listing = await (await client.get("/api/conversations", headers=headers)).json()
            assert listing["conversations"][0]["id"] in {cid, other["id"]}
            row = next(r for r in listing["conversations"] if r["id"] == cid)
            assert row["count"] == 4 and row["preview"] == "A tiny yard with crates" and row["status"] == "succeeded"
            assert (await client.get("/api/conversations/nothere", headers=headers)).status == 404
            assert (await client.get("/api/conversations/0123456789ab", headers=headers)).status == 404
    _run(body())


def test_failed_build_is_retried_from_all_requests(games, tmp_path, fake_claude, monkeypatch):
    async def body():
        bench = bridge_mod.Workbench(state=tmp_path / "state", root=games, capture=_fake_capture)
        headers = {"X-Workbench-Token": TOKEN}
        async with TestClient(TestServer(bridge_mod.make_app(bench))) as client:
            cid = (await (await client.post("/api/conversations", headers=headers)).json())["id"]
            monkeypatch.setenv("FAKE_CLAUDE_FAIL", "1")
            first = await (await client.post(f"/api/conversations/{cid}/messages", json={"text": "yard"}, headers=headers)).json()
            job = await _wait(client, first["job"]["id"])
            assert job["status"] == "failed"
            current = await (await client.get(f"/api/conversations/{cid}", headers=headers)).json()
            assert current["messages"][1]["status"] == "failed" and current["messages"][1]["error"]

            monkeypatch.delenv("FAKE_CLAUDE_FAIL")
            second = await (await client.post(f"/api/conversations/{cid}/messages", json={"text": "with crates"}, headers=headers)).json()
            assert second["job"]["kind"] == "game"
            assert (await _wait(client, second["job"]["id"]))["status"] == "succeeded"
            assert second["conversation"]["slug"] == "yard"
    _run(body())
