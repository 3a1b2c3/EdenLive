"""Prove copied output runs without resolving runtime files from the skill checkout."""

import json
import os
import re
import select
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forge"))

import check_step1  # noqa: E402
import check_step2  # noqa: E402
import check_rounds  # noqa: E402
import check_step3  # noqa: E402
import probe_controls  # noqa: E402
from gate_fixtures import MENU_GAME, MENU_STRATEGY, write_game  # noqa: E402


def _copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


@pytest.fixture()
def project(tmp_path):
    # A space in the output path catches unquoted shell paths.
    root = tmp_path / "standalone game"
    run = write_game(
        root / "runs/step3/menu-board",
        {name: MENU_GAME[name] for name in ("index.html", "main.js", "round.mjs", "step3.json", "scene-manifest.json")},
    )
    (root / "brief.json").write_text(MENU_GAME["brief.json"], encoding="utf-8")
    # The brief lives at the project root here, so the card's relative path changes with it.
    card = json.loads((run / "step3.json").read_text())
    card["brief"] = "../../../brief.json"
    (run / "step3.json").write_text(json.dumps(card))
    for relative in ("interaction/MenuSelectionController.js", "math/ScalarUtils.js"):
        _copy(ROOT / "assets" / relative, root / "assets" / relative)
    (run / "strategy.json").write_text(json.dumps(MENU_STRATEGY), encoding="utf-8")
    _copy(ROOT / "forge/serve_step.py", root / "serve_step.py")
    _copy(ROOT / "assets/template/launch.sh", root / "launch.sh")
    (root / "launch.sh").chmod(0o755)
    (root / "package.json").write_text(json.dumps({"private": True, "type": "module"}))
    for step in (1, 2, 3):
        (root / f"runs/step{step}").mkdir(parents=True, exist_ok=True)
    return root


def _get(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=5) as response:
        return response.status, response.read()


@pytest.mark.parametrize("folder_name", ["relocated game", "forge"])
def test_copied_launcher_serves_its_own_files_from_another_cwd(project, tmp_path, folder_name):
    relocated = tmp_path / folder_name
    project.rename(relocated)
    # Distinct local vendor content proves this is not the skill's npm install.
    for relative, content in (
        ("three/build/three.module.js", "export const source = 'standalone three';"),
        ("@dimforge/rapier3d-compat/rapier.es.js", "export const source = 'standalone rapier';"),
    ):
        target = relocated / "node_modules" / relative
        target.parent.mkdir(parents=True)
        target.write_text(content)
    child = subprocess.Popen(
        [str(relocated / "launch.sh"), "step3", "--host", "127.0.0.1", "--port", "0"],
        cwd=tmp_path,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        assert select.select([child.stdout], [], [], 10)[0], "viewer never announced startup"
        line = child.stdout.readline()
        match = re.search(r"http://127\.0\.0\.1:\d+", line)
        assert match, line
        base = match.group(0)
        assert b"/runs/step3/menu-board/" in _get(base + "/")[1]
        assert _get(base + "/runs/step3/menu-board/")[0] == 200
        assert b"MenuSelectionController" in _get(base + "/assets/interaction/MenuSelectionController.js")[1]
        assert b"standalone three" in _get(base + "/vendor/three.module.js")[1]
        assert b"standalone rapier" in _get(base + "/vendor/rapier.es.js")[1]
        # This file exists in the skill checkout and was deliberately not copied.
        with pytest.raises(urllib.error.HTTPError) as error:
            _get(base + "/assets/math/WorldBasis.js")
        assert error.value.code == 404
    finally:
        child.terminate()
        child.communicate(timeout=10)


def test_launcher_rejects_an_invalid_stage(project, tmp_path):
    result = subprocess.run([str(project / "launch.sh"), "../outside"], cwd=tmp_path,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 2
    assert "Usage:" in result.stderr


def test_external_rules_use_copied_transitive_assets_and_fail_when_missing(project, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    args = ["--project-root", str(project), "runs/step3/menu-board"]
    assert check_rounds.main(args) == 0
    # Missing a copied relative import must fail even though the skill has it.
    (project / "assets/math/ScalarUtils.js").unlink()
    assert check_rounds.main(args) == 1


def test_explicit_project_root_still_rejects_outside_runs(project, capsys):
    # A run inside the skill checkout is outside this project root, so it must be refused
    # rather than silently checked from the wrong tree.
    assert check_rounds.main(["--project-root", str(project), str(ROOT / "assets")]) == 2
    assert "inside the project root" in capsys.readouterr().err


@pytest.mark.parametrize("gate", ["scene", "behavior", "acceptance", "rounds"])
def test_discovered_run_symlink_must_stay_inside_project(project, tmp_path, capsys, gate):
    run = project / "runs/step3/menu-board"
    outside = tmp_path / "outside-run"
    run.rename(outside)
    run.symlink_to(outside, target_is_directory=True)
    args = ["--project-root", str(project), "--runs", "runs/step3", "--only", "menu-board"]
    if gate == "scene":
        result = check_step1.main([*args, "--output", "evidence"])
    elif gate == "behavior":
        result = check_step2.main([*args, "--output", "evidence"])
    elif gate == "rounds":
        result = check_rounds.main(args)
    else:
        result = check_step3.main([
            *args, "--strategy", "runs/step3/menu-board/strategy.json", "--output", "evidence",
        ])
    assert result == 2
    assert "inside the project root" in capsys.readouterr().err
    assert not (project / "evidence").exists()


def _outside_path(project, tmp_path, kind, name):
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / name
    if kind == "absolute":
        return str(target), target
    if kind == "parent":
        return os.path.relpath(target, project), target
    (project / "external").symlink_to(outside, target_is_directory=True)
    return f"external/{name}", target


@pytest.mark.parametrize("kind", ["absolute", "parent", "symlink"])
@pytest.mark.parametrize("gate,option", [
    ("scene", "--output"), ("behavior", "--output"),
    ("acceptance", "--output"), ("acceptance", "--strategy"),
])
def test_external_gate_paths_are_rejected_before_writes(project, tmp_path, capsys, kind, gate, option):
    path, target = _outside_path(project, tmp_path, kind, "evidence")
    args = ["--project-root", str(project), "--runs", "runs/step3", "--only", "menu-board"]
    if gate == "scene":
        result = check_step1.main([*args, option, path])
    elif gate == "behavior":
        result = check_step2.main([*args, option, path])
    else:
        options = {"--strategy": "runs/step3/menu-board/strategy.json", "--output": "evidence"}
        options[option] = path
        result = check_step3.main([*args, *[arg for pair in options.items() for arg in pair]])
    assert result == 2
    assert "inside the project root" in capsys.readouterr().err
    assert not target.exists()
    assert not (project / "evidence").exists()


@pytest.mark.parametrize("kind", ["absolute", "parent", "symlink"])
@pytest.mark.parametrize("override", [False, True])
def test_external_brief_is_rejected_by_rules_and_playthrough(project, tmp_path, capsys, kind, override):
    path, target = _outside_path(project, tmp_path, kind, "brief.json")
    target.write_text(MENU_GAME["brief.json"])
    run = project / "runs/step3/menu-board"
    card = json.loads((run / "step3.json").read_text())
    card["brief"] = path if kind == "absolute" else f"../../../{path}"
    (run / "step3.json").write_text(json.dumps(card))
    budget_args = ["--sim-seconds", "30"] if override else []
    assert check_rounds.main(["--project-root", str(project), "runs/step3/menu-board", *budget_args]) == 1
    assert "brief must stay inside the project root" in capsys.readouterr().err
    assert check_step3.main([
        "--project-root", str(project), "--runs", "runs/step3", "--only", "menu-board",
        "--strategy", "runs/step3/menu-board/strategy.json", "--output", "evidence", *budget_args,
    ]) == 2
    assert "brief must stay inside the project root" in capsys.readouterr().err
    assert not (project / "evidence").exists()


@pytest.mark.parametrize("name", ["report.json", "scenario-1.png", "menu-board.png"])
def test_existing_evidence_symlink_cannot_write_outside_project(project, tmp_path, capsys, name):
    target = tmp_path / name
    target.write_text("keep existing content")
    output = project / "evidence"
    output.mkdir()
    (output / name).symlink_to(target)
    args = ["--project-root", str(project), "--runs", "runs/step3", "--only", "menu-board"]
    if name == "menu-board.png":
        result = check_step1.main([*args, "--output", "evidence"])
    else:
        result = check_step3.main([
            *args, "--strategy", "runs/step3/menu-board/strategy.json", "--output", "evidence",
        ])
    assert result == 2
    assert "inside the project root" in capsys.readouterr().err
    assert target.read_text() == "keep existing content"


def test_probe_server_uses_external_project_assets(project):
    server, base = probe_controls.serve("runs/step3", project)
    try:
        assert _get(base + "/menu-board/")[0] == 200
        origin = base.removesuffix("/runs/step3")
        with pytest.raises(urllib.error.HTTPError) as error:
            _get(origin + "/assets/math/WorldBasis.js")
        assert error.value.code == 404
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.slow
def test_external_browser_gates_use_project_assets_strategy_and_evidence(project, monkeypatch, tmp_path):
    three = ROOT / "node_modules/three/build/three.module.js"
    # Unit fixture is network-free; npm lockfile restoration has a separate packaging smoke check.
    _copy(three, project / "node_modules/three/build/three.module.js")
    monkeypatch.chdir(tmp_path)
    args = ["--project-root", str(project), "--runs", "runs/step3", "--only", "menu-board"]
    assert check_step2.main([*args, "--output", "runs/step3/menu-board/evidence/behavior"]) == 0
    assert list((project / "runs/step3/menu-board/evidence/behavior").glob("*.png"))
    assert check_step3.main([
        *args, "--strategy", "runs/step3/menu-board/strategy.json",
        "--output", "runs/step3/menu-board/evidence/play", "--wall-seconds", "12",
    ]) == 0
    report = json.loads((project / "runs/step3/menu-board/evidence/play/report.json").read_text())
    assert report["functional"]["status"] == "passed"
    assert [entry["status"] for entry in report["scenarios"]] == ["passed"] * 3
    assert report["validationBudget"]["source"] == str(project / "brief.json")
    (project / "assets/math/ScalarUtils.js").unlink()
    assert check_step2.main([*args, "--output", ""]) == 1
