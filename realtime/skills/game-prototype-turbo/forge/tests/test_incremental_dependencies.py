import json
import shutil
from pathlib import Path

import pytest

from _shared.attempts import record_stage
from _shared.check_dependencies import snapshot
from _shared.incremental import (CHECK_IDS, equivalent, reusable_check, settings)


def write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def project(tmp_path: Path) -> tuple[Path, Path, Path]:
    root = tmp_path / "project with spaces"
    run = root / "runs/step1/scene"
    write(root / "brief.json", json.dumps({"title": "x", "time_budget_seconds": 30}))
    write(root / "package.json", '{"private":true,"type":"module"}')
    write(root / "package-lock.json", '{}')
    write(root / "serve_step.py", 'print("serve")')
    write(root / "launch.sh", '#!/bin/sh\n')
    write(run / "step1.json", json.dumps({
        "brief": "../../../brief.json", "parameter_source": "../../../parameters.json",
        "control_scheme": "custom", "player_modality": "stationary", "core_verb": "look",
        "modules": [], "controls": [],
    }))
    write(root / "parameters.json", '{"camera": 1}')
    write(run / "index.html", '<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><script type="module" src="./main.js"></script>')
    write(run / "main.js", 'import { helper } from "./helper.js"; console.log(helper);')
    write(run / "helper.js", 'export const helper = 1;')
    write(run / "round.mjs", 'export const round = 1;')
    return root, run, root / "brief.json"


def test_evidence_and_unreferenced_files_do_not_invalidate_precise_graph(tmp_path):
    root, run, _ = project(tmp_path)
    before = snapshot(root, run, kind="scene", settings={"width": 960})
    write(run / "evidence/review.md", "review")
    write(run / "implementation-notes.md", "Unreferenced design explanation")
    write(root / "assets/unreferenced.txt", "unused")
    after = snapshot(root, run, kind="scene", settings={"width": 960})
    assert equivalent(before, after)
    assert "runs/step1/scene/helper.js" in before[0]
    assert "assets/unreferenced.txt" not in before[0] and "assets/unreferenced.txt" not in before[1]


def test_transitive_change_and_deleted_dependency_invalidate(tmp_path):
    root, run, _ = project(tmp_path)
    before = snapshot(root, run, kind="scene")
    write(run / "helper.js", 'export const helper = 2;')
    changed = snapshot(root, run, kind="scene")
    assert not equivalent(before, changed)
    (run / "helper.js").unlink()
    deleted = snapshot(root, run, kind="scene")
    assert deleted.binding["uncertain"]
    assert not equivalent(before, deleted)


@pytest.mark.parametrize("mutation", ["change", "delete"])
def test_manifest_only_asset_changes_invalidate_scene_evidence(tmp_path, mutation):
    root, run, _ = project(tmp_path)
    card = json.loads((run / "step1.json").read_text())
    card["scene_manifest"] = "scene-manifest.json"
    write(run / "step1.json", json.dumps(card))
    write(run / "scene-manifest.json", json.dumps({"elements": [
        {"id": "subject", "asset": "assets/subject.js", "binding": {"object": "subject"}},
    ]}))
    asset = root / "assets/subject.js"
    write(asset, "export const color = 1;")
    row = retained_check(root, run)
    assert reusable_check(root, run, "scene") == row
    if mutation == "change":
        write(asset, "export const color = 2;")
    else:
        asset.unlink()
    assert reusable_check(root, run, "scene") is None


def test_brief_and_parameter_source_are_inputs(tmp_path):
    root, run, brief = project(tmp_path)
    before_rules = snapshot(root, run, kind="behavior")
    before_core = snapshot(root, run, kind="scene")
    write(brief, '{"title":"changed","time_budget_seconds":30}')
    assert not equivalent(before_rules, snapshot(root, run, kind="behavior"))
    assert not equivalent(before_core, snapshot(root, run, kind="scene"))
    write(root / "parameters.json", '{"camera": 2}')
    assert not equivalent(before_core, snapshot(root, run, kind="scene"))


def test_dynamic_loader_is_conservative_and_three_background_is_not(tmp_path):
    root, run, _ = project(tmp_path)
    write(run / "main.js", 'import "./helper.js"; scene.background = new Color(0x112233);')
    precise = snapshot(root, run, kind="scene")
    assert precise.binding["uncertain"] == []
    write(run / "main.js", 'const path = window.runtimeAsset; import(path);')
    uncertain = snapshot(root, run, kind="scene")
    assert uncertain.binding["uncertain"]
    assert not equivalent(precise, uncertain)


def test_settings_and_environment_are_bound(tmp_path, monkeypatch):
    root, run, _ = project(tmp_path)
    before = snapshot(root, run, kind="scene", settings={"width": 960})
    assert not equivalent(before, snapshot(root, run, kind="scene", settings={"width": 1280}))
    monkeypatch.setenv("TZ", "Pacific/Honolulu")
    assert not equivalent(before, snapshot(root, run, kind="scene", settings={"width": 960}))
    assert settings("scene")["device_scale_factor"] == settings("acceptance")["device_scale_factor"] == 2


def retained_check(root, run, gate="scene", result="passed", extra=()):
    """Synthetic evidence tests reuse mechanics, not whether a game is playable."""
    inputs = snapshot(root, run, extra, kind=gate, settings=settings(gate))
    return record_stage(root, run, f"{CHECK_IDS[gate]}:{run.name}",
                        run / f"evidence/{gate}-{result}.json",
                        {"functional": {"status": result}, "errors": []}, inputs)


def test_changed_closure_strategy_invalidates_its_playthrough_evidence(tmp_path):
    """An edited strategy is a changed input, so its earlier pass cannot be reused.

    Changing a key, condition or click target means a different input path was
    proven; reusing the old green result would overstate what was checked.
    """
    root, run, _ = project(tmp_path)
    strategy = run / "strategy.json"
    write(strategy, json.dumps({
        "interaction_events": ["move.committed"],
        "restart_actions": [{"type": "tap", "key": "KeyR"}],
        "scenarios": [{"expect": "WON", "rules": []}, {"expect": "RUNNING", "rules": []}],
    }))
    row = retained_check(root, run, "closure", extra=[strategy])
    assert reusable_check(root, run, "closure", extra=[strategy]) == row
    assert "runs/step1/scene/strategy.json" in row["artifact"]
    # Retarget the restart key: the same artifact now describes a different input path.
    write(strategy, json.dumps({
        "interaction_events": ["move.committed"],
        "restart_actions": [{"type": "tap", "key": "Enter"}],
        "scenarios": [{"expect": "WON", "rules": []}, {"expect": "RUNNING", "rules": []}],
    }))
    assert reusable_check(root, run, "closure", extra=[strategy]) is None


def test_closure_and_acceptance_evidence_never_satisfy_each_other(tmp_path):
    """Each scope keeps its own ledger ID, so a narrower pass cannot close the wider gate."""
    root, run, _ = project(tmp_path)
    strategy = run / "strategy.json"
    write(strategy, json.dumps({"scenarios": [{"expect": "WON", "rules": []}]}))
    retained_check(root, run, "closure", extra=[strategy])
    assert reusable_check(root, run, "acceptance", extra=[strategy]) is None
    assert CHECK_IDS["closure"] != CHECK_IDS["acceptance"]


def test_old_behavior_ledger_pass_does_not_satisfy_new_closure_gate(tmp_path):
    """A pre-closure step2 pass must be rechecked under the new ledger ID."""
    root, run, _ = project(tmp_path)
    strategy = run / "strategy.json"
    write(strategy, json.dumps({
        "interaction_events": ["move.committed"],
        "restart_actions": [{"type": "tap", "key": "KeyR"}],
        "scenarios": [{"expect": "WON", "rules": []}, {"expect": "RUNNING", "rules": []}],
    }))
    retained_check(root, run, "behavior")
    assert reusable_check(root, run, "closure", extra=[strategy]) is None
    closure_row = retained_check(root, run, "closure", extra=[strategy])
    assert reusable_check(root, run, "closure", extra=[strategy]) == closure_row
    assert reusable_check(root, run, "acceptance", extra=[strategy]) is None


def with_resource(run, name):
    write(run / name, "original resource bytes")
    with (run / "index.html").open("a") as stream:
        stream.write(f'<link rel="preload" href="./{name}">')


@pytest.mark.parametrize("gate", ["behavior", "scene"])
def test_branch_reuse_follows_source_and_latest_failure_blocks_it(tmp_path, gate):
    root, source, _ = project(tmp_path)
    row = retained_check(root, source, gate)
    run = root / "runs/step2/behavior"
    shutil.copytree(source, run, ignore=shutil.ignore_patterns("evidence"))
    (run / "step1.json").rename(run / "step2.json")
    write(run / "source-artifact.json", json.dumps({"artifact": source.relative_to(root).as_posix()}))
    assert reusable_check(root, run, gate) == row
    unrelated = root / "runs/step2/other"
    shutil.copytree(source, unrelated, ignore=shutil.ignore_patterns("evidence"))
    assert reusable_check(root, unrelated, gate) is None
    retained_check(root, run, gate, "not_evaluated")
    assert reusable_check(root, run, gate) is None


@pytest.mark.parametrize("gate", ["behavior", "scene"])
def test_report_mutation_invalidates_proof_without_changing_source_snapshot(tmp_path, gate):
    root, run, _ = project(tmp_path)
    row = retained_check(root, run, gate)
    before = snapshot(root, run, kind=gate)
    assert reusable_check(root, run, gate) == row
    write(run / "evidence/observations.md", "Additional review")
    assert reusable_check(root, run, gate) == row
    report = root / row["binding"]["report"]
    write(report, report.read_text() + "\n")
    assert equivalent(before, snapshot(root, run, kind=gate))
    assert reusable_check(root, run, gate) is None


def test_changed_tool_bytes_disable_reuse(tmp_path, monkeypatch):
    import _shared.check_dependencies as dependencies
    root, run, _ = project(tmp_path)
    retained_check(root, run)
    original = dependencies.context_file
    monkeypatch.setattr(dependencies, "context_file", lambda p: "f" * 64 if p.name == "check_step1.py" else original(p))
    assert reusable_check(root, run, "scene") is None


@pytest.mark.parametrize("kind", ["escape", "symlink"])
def test_dependency_paths_cannot_escape_project(tmp_path, kind):
    root, run, _ = project(tmp_path)
    outside = tmp_path / "outside.js"
    write(outside, "export const value = 1;")
    if kind == "symlink":
        (run / "external.js").symlink_to(outside)
        ref = "./external.js"
    else:
        ref = "../../../../outside.js"
    write(run / "main.js", f'import "{ref}";')
    with pytest.raises(ValueError, match="inside the project root"):
        snapshot(root, run, kind="scene")


def test_in_project_symlink_and_space_encoded_resource_bind_target_bytes(tmp_path):
    root, run, _ = project(tmp_path)
    target = root / "assets/helper with spaces.js"
    write(target, "export const value = 1;")
    (run / "alias.js").symlink_to(target)
    write(run / "main.js", 'import "./alias.js";')
    write(run / "icon with spaces.png", "image bytes")
    with (run / "index.html").open("a") as stream:
        stream.write('<img src="./icon%20with%20spaces.png">')
    before = snapshot(root, run, kind="scene")
    assert before.binding["uncertain"] == []
    assert "assets/helper with spaces.js" in before[1]
    assert "runs/step1/scene/icon with spaces.png" in before[0]
    write(target, "export const value = 2;")
    assert not equivalent(before, snapshot(root, run, kind="scene"))


@pytest.mark.parametrize("name", ["sprite.PNG", "cue.ogg", "type.woff2", "layout.css", "model.glb",
                                 "model.gltf", "material.mtl", "effect.glsl", "data.bin", "main.js", "index.html"])
@pytest.mark.parametrize("gate", ["scene", "behavior"])
def test_referenced_resource_changes_require_current_stage_proof(tmp_path, name, gate):
    root, run, _ = project(tmp_path)
    if name not in ("main.js", "index.html"):
        with_resource(run, name)
    retained_check(root, run, gate)
    with (run / name).open("a") as stream:
        stream.write("\nchanged resource bytes")
    assert reusable_check(root, run, gate) is None


def test_optional_round_diagnostic_is_independent_of_browser_dependencies(tmp_path):
    root, run, _ = project(tmp_path)
    rounds = snapshot(root, run, kind="rounds")
    browser = snapshot(root, run, kind="behavior")
    write(run / "helper.js", "export const helper = 2;")
    assert equivalent(rounds, snapshot(root, run, kind="rounds"))
    assert not equivalent(browser, snapshot(root, run, kind="behavior"))
    browser = snapshot(root, run, kind="behavior")
    write(run / "round.mjs", "export const round = 2;")
    assert not equivalent(rounds, snapshot(root, run, kind="rounds"))
    assert not equivalent(browser, snapshot(root, run, kind="behavior"))
