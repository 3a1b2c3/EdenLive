"""Print the smallest useful task packet for the current game stage.

The packet is derived from the output project's authoritative state and run card.
It contains paths, selected capabilities/modules, executable gates and closeout
commands; it intentionally does not inline the catalogs or the full schemas.
"""

import argparse
import json
import re
import shlex
import sys
from pathlib import Path

from _shared.constants import DEFAULT_WALL_SECONDS, MAX_WALL_SECONDS, GATE_TIMEOUT_SECONDS, LOOP_CAP, STAGES, STAGE_CONTRACTS, STAGE_PROMPTS, gate_plan
from _shared.paths import resolve_inside
from _shared.run_contract import META_NAMES, read_meta
from _shared.state import load_state, next_step, state_errors

ROOT = Path(__file__).resolve().parents[1]

# Stages that drive real browser inputs from a strategy card.
PLAYTHROUGH_STAGES = ("behavior", "acceptance")

# UI catalog sections each stage owns, by anchor in assets/catalogs/ui.md. Routing by
# purpose keeps a scene/layout task from surfacing the result and menu surface.
UI_SECTIONS = {
    "scene": ("infrastructure", "core-play-surface"),
    "behavior": ("core-play-surface", "decision-feedback"),
    "acceptance": ("decision-feedback", "delivery-presentation"),
}


def _brief_path(root, stage, artifact, meta):
    if stage == "intake":
        return resolve_inside(root, artifact, "brief")
    if "brief" not in meta:
        path = resolve_inside(root, "brief.json", "brief")
        return path if path.is_file() else None
    value = meta["brief"]
    if not isinstance(value, str) or not value.strip():
        raise ValueError("brief must be a nonempty path string")
    return resolve_inside(root, artifact / value, "brief")


def _api_refs(meta, stage):
    """Return only API references that can be found in this checkout."""
    values = []
    names = []
    for value in [*(meta.get("modules") or []), *((meta.get("implementation") or {}).get("controllers") or [])]:
        if not isinstance(value, str):
            continue
        if value not in values:
            values.append(value)
        names.append(re.sub(r"[^a-z0-9]", "", Path(value).stem.lower()))
    refs = []
    for path in sorted((ROOT / "docs/api").glob("*.md")):
        stem = re.sub(r"[^a-z0-9]", "", path.stem.lower())
        if any(name == stem for name in names) or any(
                Path(value).name in path.read_text(encoding="utf-8") for value in values if Path(value).suffix == ".js"):
            if path.name == "game-ui-factory.md" and stage in UI_SECTIONS:
                refs.extend(f"{path}#{anchor}" for anchor in
                            ("shared-api", *(section for section in UI_SECTIONS[stage]
                                             if section != "infrastructure")))
            else:
                refs.append(str(path))
    return values, refs


def _strategy_path(root, stage, artifact, meta):
    """Select an existing strategy, otherwise leave an actionable placeholder.

    Behaviour and acceptance both drive real inputs, so both resolve a strategy;
    the static scene stage has no playthrough and keeps the default path.
    """
    if stage not in PLAYTHROUGH_STAGES:
        return str(root / "strategy.json")
    candidates = []
    if artifact:
        candidates.append(artifact / "strategy.json")
        if "strategy" in meta:
            value = meta["strategy"]
            if not isinstance(value, str) or not value.strip():
                raise ValueError("strategy must be a nonempty path string")
            candidates.append(artifact / value)
    candidates.append(root / "strategy.json")
    # Validate every declared location, including default paths and symlinks,
    # before selecting one. A usable default must not conceal an invalid card.
    for path in [resolve_inside(root, path, "strategy") for path in candidates]:
        if path.is_file():
            return str(path)
    return "<project-relative-strategy.json>"


def build_task_packet(project_root, state=None):
    """Build a JSON-serializable packet from a validated project state."""
    root = Path(project_root).resolve()
    state_path = root / ".state.json"
    state = load_state(state_path) if state is None else state
    errors = state_errors(state)
    if errors:
        raise ValueError("; ".join(errors))
    stage = state["current_stage"]
    message, code = next_step(state, state_path)
    packet = {
        "format": "gameblocks-task-packet/v1",
        "project_root": str(root),
        "current_stage": stage,
        "stage_prompt": STAGE_PROMPTS.get(stage),
        "exit_code": code,
        "gates": [],
        "closeout": None,
    }
    revision = next((row for row in state.get("revisions", []) if row["status"] == "in_progress"), None)
    if revision:
        packet.update({
            "status": "blocked" if code else "revision",
            "stage_prompt": "grimoire/build/revisions.md",
            "revision": revision,
            "task": {"goal": revision["request"], "loop": f"{revision['loop_count']}/{LOOP_CAP}"},
            "paths": {
                "state": str(state_path),
                "prompt": str(ROOT / "grimoire/build/revisions.md"),
                "recovery": str(ROOT / "grimoire/review/gate-recovery.md"),
                "parameter_source": str(resolve_inside(root, revision["parameter_source"], "parameter source")),
                "affected_prompts": [str(ROOT / STAGE_PROMPTS[s]) for s in revision["affected_stages"]],
                "manual_records": str(ROOT / "grimoire/review/gate-recovery.md") + "#manual-records",
            },
            "next_action": "Use the revision workflow on its retained revised artifact and record affected checks and assessments.",
        })
        if code:
            packet.update(reason=message, next_action="Stop refinement; retain evidence and report the blocker.")
        return packet
    if stage == "done":
        packet.update({"status": "complete", "task": None,
                       "paths": {"revision": str(ROOT / "grimoire/build/revisions.md")},
                       "next_action": "For a new change, retain a revised run and start a revision using paths.revision; otherwise deliver the completed game."})
        return packet

    record = state["stages"][stage]
    artifact_value = record.get("artifact")
    artifact = resolve_inside(root, artifact_value, "artifact") if artifact_value else None
    packet["paths"] = {"state": str(state_path), "artifact": str(artifact) if artifact else None,
                       "prompt": str(ROOT / STAGE_PROMPTS[stage]),
                       "recovery": str(ROOT / "grimoire/review/gate-recovery.md")}
    if code:
        packet.update(status="blocked", reason=message, task=None,
                      next_action="Stop refinement; a passing third-round review may still close through recovery.")
        return packet
    if record["status"] in ("passed",):
        packet.update(status="advance", task=None, next_action=message)
        if stage in STAGES[1:-1]:
            packet["advance"] = shlex.join([
                sys.executable, str(ROOT / "forge/scaffold.py"), "advance", "--project-root", str(root),
                "--from-stage", stage, "--name", STAGES[STAGES.index(stage) + 1],
            ])
        return packet
    meta = {} if stage == "intake" or not artifact or not artifact.is_dir() else read_meta(artifact)
    brief = _brief_path(root, stage, artifact or root / "brief.json", meta)
    modules, api_refs = _api_refs(meta, stage)
    capabilities = [value for value in meta.get("capabilities", []) if isinstance(value, str)]
    brief_data = json.loads(brief.read_text(encoding="utf-8")) if brief and brief.is_file() else {}
    if stage != "intake" and (not artifact or not artifact.is_dir()):
        packet.update(status="needs_artifact", task=None,
                      reason="The current stage has no retained run directory.",
                      next_action="Create or locate the stage's run and name its project-relative path in state before requesting gates.")
        return packet
    if stage == "intake":
        goal = "Preserve the request in a validated brief and complete the intent review."
    else:
        goal = STAGE_CONTRACTS[stage]["goal"]

    values = {
        "root": str(root),
        "run": str(artifact) if artifact else str(root / "brief.json"),
        "runs": str(artifact.parent) if artifact and artifact.is_dir() else str(root / "runs"),
        "name": artifact.name if artifact else "<name>",
        "output": str(artifact / "evidence" / "task-packet") if artifact else str(root / "evidence"),
        "strategy": _strategy_path(root, stage, artifact, meta),
    }
    gates = []
    if stage in STAGES:
        for gate, argv, report in gate_plan(stage, values, sys.executable, str(ROOT / "forge")):
            gates.append({"id": gate, "command": shlex.join(argv), "report": report})

    contract = STAGE_CONTRACTS.get(stage)
    packet.update({
        "status": record.get("status"),
        "task": {"goal": goal, "loop": f"{record.get('loop_count', 0)}/{LOOP_CAP}",
                 **({"delivers": list(contract["delivers"]), "defers": list(contract["defers"]),
                     "evidence_scope": contract["evidence"],
                     **({"migration": contract["migration"]} if contract.get("migration") else {})}
                    if contract else {})},
        "paths": {
            "state": str(state_path),
            "artifact": str(artifact) if artifact else None,
            "brief": str(brief) if brief else None,
            "metadata": str(next((artifact / name for name in META_NAMES if artifact and (artifact / name).is_file()), "")) or None,
            "prompt": str(ROOT / STAGE_PROMPTS[stage]),
            "contract": str(ROOT / "grimoire/review/shared-contract.md"),
        },
        "selection": {
            "control_scheme": meta.get("control_scheme", brief_data.get("control_scheme")),
            "player_modality": meta.get("player_modality", brief_data.get("player_modality")),
            "ui_mode": brief_data.get("ui", {}).get("mode", "polish"),
            "capabilities": capabilities,
            "modules": modules,
            "api_refs": api_refs,
        },
        "gates": gates,
        "closeout": {
            "usage": "Run check once; it selects reusable evidence and remaining gates. Use the individual gate commands only for diagnostics or manual checks.",
            "check": shlex.join([sys.executable, str(ROOT / "forge/finish.py"), "--project-root", str(root), "--check"]),
            "review": shlex.join([sys.executable, str(ROOT / "forge/finish.py"),
                                   "--project-root", str(root), "--review", "<review.json>"]),
            "conditions": ["gate reports pass", "required intent/experience/performance review is recorded", "evidence remains under the project output root"],
        },
    })
    if stage == "behavior":
        packet["paths"]["input_contract"] = str(ROOT / "grimoire/review/input-contract.md")
        packet["paths"]["playthrough_contract"] = str(ROOT / "grimoire/review/playthrough-contract.md")
    # Route UI by purpose: hand out only the catalog sections this stage owns, so a
    # layout task does not surface result cards and menus. An explicit no-UI brief
    # gets none of them; it still owns observable outcomes and an operable restart.
    ui_sections = UI_SECTIONS.get(stage) if packet["selection"]["ui_mode"] != "none" else None
    if ui_sections:
        catalog = ROOT / "assets/catalogs/ui.md"
        packet["paths"]["ui_sections"] = [f"{catalog}#{anchor}" for anchor in ui_sections]
    if stage in PLAYTHROUGH_STAGES:
        scope = "closure" if stage == "behavior" else "acceptance"
        packet['paths']['strategy'] = values['strategy']
        packet['validation_budgets'] = {
            'simulation_seconds_per_scenario': brief_data.get('time_budget_seconds'),
            'wall_seconds_per_scenario': DEFAULT_WALL_SECONDS,
            'max_wall_seconds_per_scenario': MAX_WALL_SECONDS,
            'gate_timeout_seconds': GATE_TIMEOUT_SECONDS,
            'reference': str(ROOT / 'grimoire/review/playthrough-contract.md') + '#validation-budgets',
        }
        packet['preflight'] = shlex.join([
            sys.executable, str(ROOT / 'forge/check_step3.py'), '--validate-only', '--scope', scope,
            '--project-root', str(root), '--strategy', values['strategy'],
        ])
        packet["closeout"]["check"] += f" --strategy {shlex.quote(values['strategy'])}"
        if values["strategy"].startswith("<"):
            packet["closeout"]["conditions"].append(
                "replace the strategy placeholder with an existing project-relative strategy path"
            )
        packet["closeout"]["conditions"].append(
            "real-input strategy reaches one terminal outcome, a real restart and a fresh round that accepts input"
            if scope == "closure" else
            "real-input strategy proves win, loss, restart and replay")
    return packet


def main(argv=None):
    parser = argparse.ArgumentParser(description="Print the current stage's compact task packet.")
    parser.add_argument("--project-root", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        packet = build_task_packet(args.project_root)
        print(json.dumps(packet, indent=2, ensure_ascii=False))
        return packet["exit_code"]
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
