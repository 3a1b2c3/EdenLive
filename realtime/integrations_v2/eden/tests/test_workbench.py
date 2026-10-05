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
if "GamePrototypeTurbo" in prompt:
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


def test_caption_is_sanitized_and_accept_replaces_cover(games, tmp_path, fake_claude, monkeypatch):
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


def test_flux_prompt_uses_skill_instruction():
    skill = flux_worker.load_skill_module()
    assert flux_worker.build_prompt(skill, " a yard ") == f"{skill.EDIT_INSTRUCTION} Scene: a yard"


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
                assert script.status == 200 and "Workbench" in await script.text()
    asyncio.run(body())
