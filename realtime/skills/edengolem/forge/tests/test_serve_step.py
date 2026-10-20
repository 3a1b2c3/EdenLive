"""Tests for forge/serve_step.py (the prototype viewer for any stage).

The viewer is what makes the stage-1 products reviewable, so its two
load-bearing behaviours are pinned here: run discovery (which builds the index)
and path resolution (which is why a plain http.server does not work).
"""

import sys
import threading
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "forge"))

from serve_step import (  # noqa: E402
    REPO_ROOT as SERVER_ROOT,
    ReusableServer,
    Step1Handler,
    discover_runs,
    render_index,
)


def _make_run(runs_dir: Path, name: str, meta: str | None = None) -> Path:
    run = runs_dir / name
    run.mkdir(parents=True)
    (run / "index.html").write_text("<!DOCTYPE html><title>x</title>", encoding="utf-8")
    (run / "main.js").write_text("export function start() {}\n", encoding="utf-8")
    if meta is not None:
        (run / "step1.json").write_text(meta, encoding="utf-8")
    return run


def test_discover_runs_finds_only_real_runs(tmp_path) -> None:
    runs_dir = tmp_path / "runs"
    _make_run(runs_dir, "alpha")
    _make_run(runs_dir, "beta")
    # Underscore folders are shared scaffolding (_shared, _template), not runs.
    _make_run(runs_dir, "_template")
    # A folder without index.html is not runnable, so it must not be listed.
    (runs_dir / "not-a-run").mkdir()
    (runs_dir / "not-a-run" / "notes.md").write_text("wip", encoding="utf-8")

    names = [run["name"] for run in discover_runs(runs_dir)]
    assert names == ["alpha", "beta"]


def test_discover_runs_is_empty_for_a_missing_directory(tmp_path) -> None:
    assert discover_runs(tmp_path / "absent") == []


def test_discover_runs_reads_meta_and_survives_bad_json(tmp_path) -> None:
    runs_dir = tmp_path / "runs"
    _make_run(runs_dir, "good", meta='{"control_scheme": "vehicle"}')
    _make_run(runs_dir, "broken", meta="{not json")

    runs = {run["name"]: run["meta"] for run in discover_runs(runs_dir)}
    assert runs["good"]["control_scheme"] == "vehicle"
    # A malformed step1.json must surface as a reported error, not crash the
    # viewer and hide every other run.
    assert "error" in runs["broken"]


def test_discover_runs_reads_step2_metadata(tmp_path) -> None:
    """A behavior run carries step2.json; scene runs carry step1.json.

    The viewer originally read step1.json only, so every stage-2 card rendered
    with '?' tags and empty fields -- served, and useless.
    """
    runs_dir = tmp_path / "runs"
    stage2 = _make_run(runs_dir, "stage2")
    (stage2 / "step1.json").unlink(missing_ok=True)
    (stage2 / "step2.json").write_text(
        '{"control_scheme": "top_down_world", "stage": 2}', encoding="utf-8"
    )
    _make_run(runs_dir, "stage1", meta='{"control_scheme": "vehicle"}')

    runs = {run["name"]: run["meta"] for run in discover_runs(runs_dir)}
    assert runs["stage2"]["control_scheme"] == "top_down_world"
    assert runs["stage2"]["stage"] == 2
    assert runs["stage1"]["control_scheme"] == "vehicle"


def test_step2_metadata_wins_when_both_are_present(tmp_path) -> None:
    """A run promoted from stage 1 keeps both files; the newer stage must win."""
    runs_dir = tmp_path / "runs"
    run = _make_run(runs_dir, "promoted", meta='{"control_scheme": "old"}')
    (run / "step2.json").write_text('{"control_scheme": "new"}', encoding="utf-8")

    meta = discover_runs(runs_dir)[0]["meta"]
    assert meta["control_scheme"] == "new"


def test_render_index_lists_runs_and_escapes_metadata(tmp_path) -> None:
    runs_dir = tmp_path / "runs"
    _make_run(
        runs_dir,
        "alpha",
        meta='{"core_verb": "Drive <fast> & win", "modules": ["actor-motion/X"]}',
    )
    page = render_index(discover_runs(runs_dir), "tmp/step1-runs").decode("utf-8")

    assert "alpha" in page
    assert "/tmp/step1-runs/alpha/" in page
    assert "actor-motion/X" in page
    # Brief text is untrusted for HTML purposes; it must not inject markup.
    assert "<fast>" not in page
    assert "&lt;fast&gt;" in page


def test_render_index_reports_an_empty_run_directory(tmp_path) -> None:
    page = render_index([], "tmp/step1-runs").decode("utf-8")
    assert "No runs found" in page


@pytest.fixture()
def server(tmp_path):
    """A live viewer bound to a free port, serving the real repository root."""
    runs_dir = tmp_path / "runs"
    _make_run(runs_dir, "alpha", meta='{"core_verb": "test"}')

    handler = partial(Step1Handler, runs_dir=runs_dir, runs_rel="tmp/step1-runs")
    httpd = ReusableServer(("127.0.0.1", 0), handler)
    # ReusableServer is a ThreadingTCPServer, not an HTTPServer, so it has no
    # server_port attribute; read the bound port off the socket instead.
    port = httpd.socket.getsockname()[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", runs_dir
    finally:
        httpd.shutdown()
        httpd.server_close()


def _get(url: str):
    with _open_local(url) as response:
        return response.status, response.read()


def _open_local(url: str):
    # These requests target our loopback fixture, independently of shell proxies.
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=10)


def test_server_serves_a_generated_index(server) -> None:
    base, _ = server
    status, body = _get(f"{base}/")
    assert status == 200
    assert b"Game prototypes" in body


def test_server_resolves_library_modules_from_the_repo_root(server) -> None:
    """The reason this is not `python -m http.server` run inside a run folder.

    Prototypes import `/assets/...`; serving the run directory alone would 404.
    """
    base, _ = server
    status, body = _get(f"{base}/assets/math/WorldBasis.js")
    assert status == 200
    assert b"export class WorldBasis" in body


def test_server_maps_vendor_three_to_the_pinned_build(server) -> None:
    base, _ = server
    local = SERVER_ROOT / "node_modules" / "three" / "build" / "three.module.js"
    if not local.is_file():
        pytest.skip("three is not installed locally; the server redirects to the CDN")

    status, body = _get(f"{base}/vendor/three.module.js")
    assert status == 200
    # The import map points bare "three" here, so this must be the real build.
    assert b"REVISION" in body


def test_server_sends_no_store_so_edits_are_never_stale(server) -> None:
    base, _ = server
    with _open_local(f"{base}/assets/math/ScalarUtils.js") as response:
        assert "no-store" in response.headers.get("Cache-Control", "")


def test_server_404s_a_missing_path(server) -> None:
    base, _ = server
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        _get(f"{base}/assets/does-not-exist.js")
    assert excinfo.value.code == 404


def test_step3_metadata_wins_after_promotion(tmp_path):
    runs_dir = tmp_path / 'runs'
    run = _make_run(runs_dir, 'promoted')
    (run / 'step2.json').write_text('{"core_verb":"old"}')
    (run / 'step3.json').write_text('{"core_verb":"live"}')
    assert discover_runs(runs_dir)[0]['meta']['core_verb'] == 'live'
