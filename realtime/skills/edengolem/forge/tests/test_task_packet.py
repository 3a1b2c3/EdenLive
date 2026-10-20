import json
import importlib
import shlex
import subprocess
from pathlib import Path

import pytest

from _shared.constants import STAGES
from _shared.starters import starter_strategy
from scaffold import encoded, initialize
from task_packet import build_task_packet, main as packet_main
from test_state import progressed_state
from validate_game_brief import starter_brief, validate_brief


ROOT = Path(__file__).resolve().parents[2]


def test_packet_for_initialized_intake_has_real_paths_and_gates(tmp_path, monkeypatch):
    root = tmp_path / "game"
    monkeypatch.setattr("scaffold.subprocess.run", lambda *a, **k: None)
    brief = starter_brief()
    brief.update({
        "title": "Packet fixture",
        "core_verb": "Choose a route",
        "fantasy": "Find the safe way home",
        "player_modality": "menu",
        "fail_state": "Choose a blocked route",
        "win_state": "Choose the open route",
        "scene": {"description": "A small route board", "theme_elements": [{"id": "board", "label": "Route board", "role": "board"}]},
    })
    brief_path = tmp_path / "brief.json"
    brief_path.write_text(json.dumps(brief), encoding="utf-8")
    initialize(root, "scene", brief_path)

    packet = build_task_packet(root)
    assert packet["current_stage"] == "intake"
    assert Path(packet["paths"]["state"]) == root / ".state.json"
    assert Path(packet["paths"]["brief"]) == root / "brief.json"
    assert packet["gates"][0]["id"] == "brief"
    assert "validate_game_brief.py" in packet["gates"][0]["command"]
    assert packet["closeout"]["check"].endswith("--check")


def test_packet_routes_selected_capabilities_without_catalog_dump(tmp_path):
    root = tmp_path
    run = root / "runs/step1/demo"
    run.mkdir(parents=True)
    (run / "step1.json").write_text(json.dumps({
        "brief": "../../../brief.json", "modules": ["/assets/interaction/MenuSelectionController.js"],
        "controls": [], "control_scheme": "custom", "player_modality": "menu", "core_verb": "choose",
        "capabilities": ["discrete_state"],
    }), encoding="utf-8")
    (root / "brief.json").write_text(json.dumps({
        "ui": {"mode": "polish"}, "title": "x", "core_verb": "choose", "fantasy": "x",
        "control_scheme": "custom", "player_modality": "menu", "fail_state": "bad", "win_state": "good",
        "interaction_tags": [], "time_budget_seconds": 30, "context": {}, "scene": {"description": "x"},
    }), encoding="utf-8")
    state = {"current_stage": "scene", "stages": {stage: {
        "status": "passed" if STAGES.index(stage) < 1 else "in_progress" if stage == "scene" else "not_started",
        "loop_count": 0, "evidence": ["brief.json"] if STAGES.index(stage) < 1 else [],
        **({"artifact": "brief.json"} if stage == "intake" else {}),
        **({"artifact": "runs/step1/demo"} if stage == "scene" else {}),
    } for stage in STAGES}}
    (root / ".state.json").write_bytes(encoded(state))
    packet = build_task_packet(root)
    assert packet["selection"]["capabilities"] == ["discrete_state"]
    assert packet["selection"]["modules"] == ["/assets/interaction/MenuSelectionController.js"]
    assert all("catalog" not in gate["command"] for gate in packet["gates"])


def test_packet_rejects_invalid_state(tmp_path):
    (tmp_path / ".state.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError):
        build_task_packet(tmp_path)


def packet_project(root, stage="scene", brief=None, meta=None):
    """Minimal retained run and state; no game pass is asserted by these fixtures."""
    root.mkdir(parents=True, exist_ok=True)
    run = root / f"runs/step{STAGES.index(stage)}/demo"
    run.mkdir(parents=True)
    if brief is None:
        brief = {"control_scheme": "custom", "player_modality": "menu", "ui": {"mode": "polish"}}
    (root / "brief.json").write_bytes(encoded(brief))
    if meta is not None:
        (run / f"step{STAGES.index(stage)}.json").write_bytes(encoded(meta))
    state = progressed_state(stage)
    state["stages"][stage].update(status="in_progress", artifact=run.relative_to(root).as_posix())
    (root / ".state.json").write_bytes(encoded(state))
    return run, state


def test_behavior_packet_routes_input_guidance_and_the_closure_check(tmp_path):
    packet_project(tmp_path, "behavior")
    packet = build_task_packet(tmp_path)
    # Behaviour owns the playable loop, so it checks capability inputs and then
    # proves the loop closes through a real terminal, restart and replay.
    assert [row['id'] for row in packet['gates']] == ['behavior', 'closure']
    assert '--boot-only' not in shlex.split(packet['gates'][0]['command'])
    closure = shlex.split(packet['gates'][1]['command'])
    assert closure[1].endswith('check_step3.py')
    assert closure[closure.index('--scope') + 1] == 'closure'
    assert Path(packet['paths']['input_contract']).is_file()
    assert Path(packet['paths']['playthrough_contract']).is_file()
    assert 'wiring' not in packet  # An unselected update/input model is not prescribed.


def test_behavior_packet_states_its_deliverables_and_evidence_scope(tmp_path):
    packet_project(tmp_path, "behavior")
    task = build_task_packet(tmp_path)["task"]
    # The packet, not just the prose, must place outcomes and restart in this stage
    # and defer only presentation, or the agent will rebuild them later.
    assert any('restart' in row for row in task['delivers'])
    assert any('win' in row and 'loss' in row for row in task['delivers'])
    assert any('acceptance' in row for row in task['defers'])
    assert 'not evaluated here' in task['evidence_scope']


def test_acceptance_packet_explains_closure_strategy_migration(tmp_path):
    packet_project(tmp_path, "acceptance")
    migration = build_task_packet(tmp_path)["task"]["migration"]
    assert 'WON -> LOST -> WON' in migration
    assert 'closure' in migration


@pytest.mark.parametrize("stage,owned,withheld", [
    ("scene", ["infrastructure", "core-play-surface"], ["delivery-presentation"]),
    ("behavior", ["decision-feedback"], ["delivery-presentation"]),
    ("acceptance", ["delivery-presentation"], ["infrastructure"]),
])
def test_ui_catalog_is_routed_by_purpose_per_stage(tmp_path, stage, owned, withheld):
    """A layout stage must not be handed result cards, nor acceptance the input shell."""
    root = tmp_path / stage
    packet_project(root, stage)
    sections = build_task_packet(root)["paths"]["ui_sections"]
    anchors = [path.split("#", 1)[1] for path in sections]
    assert all(anchor in anchors for anchor in owned)
    assert not any(anchor in anchors for anchor in withheld)
    # The document validator strips anchors, so the catalog headings are checked here.
    catalog = ROOT / "assets/catalogs/ui.md"
    assert all(Path(path.split("#", 1)[0]) == catalog for path in sections)
    headings = {line.strip("# ").strip().lower().replace(" ", "-")
                for line in catalog.read_text(encoding="utf-8").splitlines() if line.startswith("## ")}
    assert set(anchors) <= headings


def test_no_ui_brief_gets_no_interface_sections(tmp_path):
    """An explicit no-UI brief still owns outcomes and restart, but reads no UI catalog."""
    root = tmp_path / "plain"
    packet_project(root, "behavior", brief={"ui": {"mode": "none", "reason": "No UI polish requested."}})
    packet = build_task_packet(root)
    assert "ui_sections" not in packet["paths"]
    assert any("restart" in row for row in packet["task"]["delivers"])


@pytest.mark.parametrize("stage,sections", [
    ("scene", ["shared-api", "core-play-surface"]),
    ("behavior", ["shared-api", "core-play-surface", "decision-feedback"]),
    ("acceptance", ["shared-api", "decision-feedback", "delivery-presentation"]),
])
@pytest.mark.parametrize("module", ["GameUiFactory", "/assets/user-interface/GameUiAdapter.js"])
def test_selected_ui_api_keeps_stage_routing(tmp_path, stage, sections, module):
    """Module discovery must not bypass the catalog's progressive disclosure."""
    packet_project(tmp_path, stage, meta={"modules": [module]})
    refs = build_task_packet(tmp_path)["selection"]["api_refs"]
    api = ROOT / "docs/api/game-ui-factory.md"
    assert refs == [f"{api}#{section}" for section in sections]
    headings = {line.strip("# ").strip().lower().replace(" ", "-")
                for line in api.read_text(encoding="utf-8").splitlines() if line.startswith("## ")}
    assert set(sections) <= headings


BRIEFS = sorted((ROOT / "assets/game-briefs").glob("*.brief.json"))


@pytest.mark.parametrize("brief_path", BRIEFS, ids=lambda p: p.stem)
def test_every_reference_brief_keeps_its_intent_and_stage_routing(tmp_path, brief_path):
    brief = json.loads(brief_path.read_text())
    assert not validate_brief(brief)
    for stage in STAGES:
        root = tmp_path / stage
        run, state = packet_project(root, stage, brief=brief)
        if stage == "intake":
            state["stages"][stage]["artifact"] = "brief.json"
        before = (root / "brief.json").read_bytes()
        packet = build_task_packet(root, state)
        assert packet["current_stage"] == stage
        assert packet["selection"]["control_scheme"] == brief["control_scheme"]
        assert packet["selection"]["player_modality"] == brief["player_modality"]
        assert packet["selection"]["ui_mode"] == brief["ui"]["mode"]
        assert packet["selection"]["capabilities"] == []  # Selected by implementation, never by genre name.
        assert packet["selection"]["modules"] == []
        assert packet["selection"]["api_refs"] == []
        for gate in packet["gates"]:
            argv = shlex.split(gate["command"])
            assert Path(argv[1]).is_file()
            if "--runs" in argv:
                assert Path(argv[argv.index("--runs") + 1]) == run.parent
        assert Path(packet["paths"]["brief"]) == root / "brief.json"
        assert (root / "brief.json").read_bytes() == before


@pytest.mark.parametrize("stage", ["scene", "done"])
@pytest.mark.parametrize("loops", [0, 3])
def test_revision_precedes_stage_or_completion_and_preserves_cap(tmp_path, stage, loops, capsys):
    _, state = packet_project(tmp_path)
    if stage == "done":
        state = progressed_state("done")
    revision = {"id": "input-fix", "request": "Correct focus ownership", "affected_stages": ["scene", "acceptance"],
                "status": "in_progress", "loop_count": loops, "evidence": [],
                "parameter_source": "parameters.json", "regressions": ["focus and repeated input"]}
    state["revisions"] = [revision]
    (tmp_path / ".state.json").write_bytes(encoded(state))
    packet = build_task_packet(tmp_path)
    assert packet["revision"] == revision
    assert packet["status"] == ("blocked" if loops == 3 else "revision")
    assert packet["gates"] == [] and packet["closeout"] is None
    assert Path(packet["paths"]["prompt"]).is_file()
    code = importlib.import_module("next").main([str(tmp_path / ".state.json"), "--task-packet"])
    assert code == (3 if loops == 3 else 0)
    assert json.loads(capsys.readouterr().out) == packet


def test_stage_cap_removes_refinement_commands_from_both_clis(tmp_path, capsys):
    _, state = packet_project(tmp_path)
    state["stages"]["scene"]["loop_count"] = 3
    (tmp_path / ".state.json").write_bytes(encoded(state))
    for main, argv in [
        (packet_main, ["--project-root", str(tmp_path)]),
        (importlib.import_module("next").main, [str(tmp_path / ".state.json"), "--task-packet"]),
    ]:
        assert main(argv) == 3
        packet = json.loads(capsys.readouterr().out)
        assert packet["status"] == "blocked"
        assert packet["gates"] == [] and packet["closeout"] is None


def test_passed_stage_routes_to_advance_without_rechecking(tmp_path):
    state = progressed_state("behavior")
    state["current_stage"] = "scene"
    state["stages"]["scene"]["loop_count"] = 3  # A passing third round can advance.
    packet = build_task_packet(tmp_path, state)
    assert packet["status"] == "advance" and packet["exit_code"] == 0
    assert packet["gates"] == [] and packet["closeout"] is None
    argv = shlex.split(packet["advance"])
    assert argv[argv.index("--from-stage") + 1] == "scene"


def test_done_packet_remains_complete(tmp_path):
    packet = build_task_packet(tmp_path, progressed_state("done"))
    assert packet["status"] == "complete" and packet["exit_code"] == 0
    assert packet["gates"] == [] and packet["closeout"] is None


def test_missing_run_requests_recovery_instead_of_checking_a_brief_as_a_game(tmp_path):
    packet = build_task_packet(tmp_path, progressed_state("scene"))
    assert packet["status"] == "needs_artifact"
    assert packet["gates"] == [] and packet["closeout"] is None


def test_explicit_no_ui_still_requires_acceptance_and_relocation(tmp_path):
    _, state = packet_project(tmp_path, "acceptance", brief={"ui": {"mode": "none", "reason": "No UI polish requested."}})
    packet = build_task_packet(tmp_path, state)
    assert [gate["id"] for gate in packet["gates"]] == ["acceptance", "relocation"]


@pytest.mark.parametrize("scheme,modality", [("custom", "stationary"), ("top_down_world", "hybrid")])
def test_packet_uses_selected_run_capabilities_and_resolves_camelcase_apis(tmp_path, scheme, modality):
    meta = {"brief": "brief.json", "control_scheme": scheme, "player_modality": modality,
            "capabilities": ["custom", "discrete_state", "targeting"],
            "modules": ["CharacterVisualFactory", "/assets/world/object/factory/TreeVisualFactory.js"],
            "implementation": {"controllers": ["CustomInputOwner"]}}
    run, _ = packet_project(tmp_path, meta=meta)
    (run / "brief.json").write_bytes(encoded({"control_scheme": "third_person", "player_modality": "avatar"}))
    packet = build_task_packet(tmp_path)
    assert Path(packet["paths"]["brief"]) == run / "brief.json"
    assert packet["selection"]["control_scheme"] == scheme
    assert packet["selection"]["player_modality"] == modality
    assert packet["selection"]["capabilities"] == meta["capabilities"]
    assert "CustomInputOwner" in packet["selection"]["modules"]
    refs = packet["selection"]["api_refs"]
    assert str(ROOT / "docs/api/character-visual-factory.md") in refs
    assert str(ROOT / "docs/api/tree-visual-factory.md") in refs
    assert all(Path(ref).is_absolute() and Path(ref).is_file() for ref in refs)


def test_strategy_precedence_and_shell_quoting_in_a_project_path_with_spaces(tmp_path):
    root = tmp_path / "game with spaces"
    run, _ = packet_project(root, "acceptance", meta={"strategy": "strategies/play through.json"})
    candidates = [run / "strategy.json", run / "strategies/play through.json", root / "strategy.json"]
    for path in candidates:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}")
    for path in candidates:
        packet = build_task_packet(root)
        assert packet["paths"]["strategy"] == str(path)
        for command in [packet["gates"][0]["command"], packet["closeout"]["check"], packet["preflight"]]:
            argv = shlex.split(command)
            assert argv[argv.index("--project-root") + 1] == str(root)
            assert argv[argv.index("--strategy") + 1] == str(path)
        path.unlink()
    packet = build_task_packet(root)
    argv = shlex.split(packet["closeout"]["check"])
    assert argv[argv.index("--strategy") + 1] == "<project-relative-strategy.json>"


def test_acceptance_packet_offers_an_offline_strategy_preflight(tmp_path):
    """Syntax mistakes should surface before a browser run spends a review loop."""
    root = tmp_path / "game"
    run, _ = packet_project(root, "acceptance")
    (run / "strategy.json").write_bytes(encoded({"scenarios": []}))
    packet = build_task_packet(root)
    argv = shlex.split(packet["preflight"])
    assert argv[1].endswith("check_step3.py")
    assert "--validate-only" in argv
    # A preflight that could write evidence or spend an attempt is not a preflight.
    assert "--output" not in argv and "--record-attempt" not in argv
    assert subprocess.run(argv, capture_output=True, text=True).returncode == 1
    (run / "strategy.json").write_bytes(encoded(starter_strategy()))
    assert Path(shlex.split(build_task_packet(root)["preflight"])[-1]) == run / "strategy.json"


def test_scene_packet_has_no_strategy_preflight(tmp_path):
    """The static scene stage drives no inputs, so it must not ask for a strategy."""
    root = tmp_path / "scene"
    packet_project(root, "scene")
    packet = build_task_packet(root)
    assert "preflight" not in packet
    assert "strategy" not in packet["paths"]


def authored_strategy(scope):
    """A draft with its gameplay choices filled in, as a stage would leave it."""
    return {**starter_strategy(scope), "interaction_events": ["move.committed"],
            "restart_actions": [{"type": "tap", "key": "KeyR"}]}


@pytest.mark.parametrize("stage,scope", [("behavior", "closure"), ("acceptance", "acceptance")])
def test_playthrough_packets_preflight_their_own_scope(tmp_path, stage, scope):
    """Both input-driving stages preflight a strategy, each bound to its own scope."""
    root = tmp_path / stage
    run, _ = packet_project(root, stage)
    (run / "strategy.json").write_bytes(encoded(authored_strategy(scope)))
    packet = build_task_packet(root)
    argv = shlex.split(packet["preflight"])
    assert argv[1].endswith("check_step3.py")
    assert argv[argv.index("--scope") + 1] == scope
    # A preflight must not write evidence or spend an attempt in either scope.
    assert "--output" not in argv and "--record-attempt" not in argv
    assert Path(argv[-1]) == run / "strategy.json"
    assert subprocess.run(argv, capture_output=True, text=True).returncode == 0
    # An unedited draft still fails readiness in both scopes.
    (run / "strategy.json").write_bytes(encoded(starter_strategy(scope)))
    assert subprocess.run(argv, capture_output=True, text=True).returncode == 1
    # The other scope's sequence must not satisfy this stage's preflight.
    other = "acceptance" if scope == "closure" else "closure"
    (run / "strategy.json").write_bytes(encoded(authored_strategy(other)))
    assert subprocess.run(argv, capture_output=True, text=True).returncode == 1


@pytest.mark.parametrize("kind", ["escape", "symlink", "blank"])
def test_strategy_paths_must_be_nonempty_and_inside_project(tmp_path, kind):
    root = tmp_path / "game"
    run, _ = packet_project(root, "acceptance")
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    if kind == "symlink":
        (run / "strategy.json").symlink_to(outside)
        meta = {}
    else:
        meta = {"strategy": str(outside) if kind == "escape" else " "}
        (run / "strategy.json").write_text("{}")  # A valid default must not conceal a bad card.
    (run / "step3.json").write_bytes(encoded(meta))
    with pytest.raises(ValueError, match="strategy"):
        build_task_packet(root)


def test_root_strategy_symlink_and_brief_escape_are_rejected(tmp_path):
    root = tmp_path / "game"
    run, _ = packet_project(root, "acceptance")
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    (root / "strategy.json").symlink_to(outside)
    with pytest.raises(ValueError, match="strategy"):
        build_task_packet(root)
    (root / "strategy.json").unlink()
    (run / "step3.json").write_bytes(encoded({"brief": str(outside)}))
    with pytest.raises(ValueError, match="brief"):
        build_task_packet(root)


def test_completed_game_routes_new_changes_to_revision_without_reopening_stages(tmp_path):
    state = progressed_state('done')
    before = encoded(state)
    packet = build_task_packet(tmp_path, state)
    assert Path(packet['paths']['revision']).is_file()
    assert packet['status'] == 'complete'
    assert encoded(state) == before


@pytest.mark.parametrize('stage', ['behavior', 'acceptance'])
def test_packet_exposes_separate_playthrough_limits(tmp_path, stage):
    from _shared.constants import DEFAULT_WALL_SECONDS, MAX_WALL_SECONDS, GATE_TIMEOUT_SECONDS
    packet_project(tmp_path, stage, brief={'time_budget_seconds': 120})
    budgets = build_task_packet(tmp_path)['validation_budgets']
    assert budgets['simulation_seconds_per_scenario'] == 120
    assert budgets['wall_seconds_per_scenario'] == DEFAULT_WALL_SECONDS
    assert budgets['max_wall_seconds_per_scenario'] == MAX_WALL_SECONDS
    assert budgets['gate_timeout_seconds'] == GATE_TIMEOUT_SECONDS
