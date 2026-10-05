"""Shared state logic for stage closeout, validation and recovery.

Loads .state.json, validates it against docs/specs/state.schema.json plus the gate
invariants the JSON Schema cannot express (stage order, completion, evidence), and computes the next step. Both CLIs import these so the
contract lives in exactly one place.
"""

import json
from pathlib import Path

from jsonschema import Draft7Validator

from _shared.constants import LOOP_CAP, STAGES, STAGE_GATES, STAGE_PROMPTS

STATE_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "docs" / "specs" / "state.schema.json"


def load_state(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def state_errors(state):
    """Return a list of messages; empty means the state is valid (fail closed)."""
    schema = json.loads(STATE_SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = []
    for err in Draft7Validator(schema).iter_errors(state):
        location = ".".join(str(part) for part in err.path) or "<root>"
        errors.append(f"{location}: {err.message}")

    if not isinstance(state, dict) or not isinstance(state.get("stages", {}), dict):
        return errors
    for stage_id, record in state.get("stages", {}).items():
        if not isinstance(record, dict):
            continue  # The schema has already reported the malformed record.
        status = record.get("status")
        if status == "passed" and not record.get("evidence"):
            errors.append(f"stages.{stage_id}: status 'passed' requires non-empty evidence")
        if status == "passed" and stage_id != "intake" and "assessments" not in record:
            errors.append(f"stages.{stage_id}: status 'passed' requires functional, experience and performance assessments")
        loop = record.get("loop_count")
        if not isinstance(loop, int) or isinstance(loop, bool) or not (0 <= loop <= LOOP_CAP):
            errors.append(f"stages.{stage_id}: loop_count must be 0..{LOOP_CAP}, got {loop!r}")
    current = state.get("current_stage")
    required_count = 0
    if current == "done":
        required_count = len(STAGES)
    elif current in STAGES:
        required_count = STAGES.index(current)
    unfinished = None
    for index, stage_id in enumerate(STAGES):
        record = state.get("stages", {}).get(stage_id)
        if not isinstance(record, dict):
            continue  # Missing/malformed records are already schema errors.
        status = record.get("status")
        if index < required_count and status not in ("passed",):
            errors.append(f"current_stage {current!r} requires stages.{stage_id} to be passed")
        if unfinished and status in ("in_progress", "passed"):
            errors.append(f"stages.{stage_id}: cannot advance before stages.{unfinished} is passed")
        if unfinished is None and status not in ("passed",):
            unfinished = stage_id

    revisions = state.get("revisions", [])
    if isinstance(revisions, list):
        ids = [r["id"] for r in revisions if isinstance(r, dict) and isinstance(r.get("id"), str)]
        if len(ids) != len(set(ids)):
            errors.append("revisions: duplicate id")
        if sum(isinstance(r, dict) and r.get("status") == "in_progress" for r in revisions) > 1:
            errors.append("revisions: only one active revision allowed")
        for r in revisions:
            if isinstance(r, dict) and r.get("status") == "passed" and not r.get("evidence"):
                errors.append("revision passed requires evidence")
            if isinstance(r, dict) and r.get("status") == "passed" and "assessments" not in r:
                errors.append(f"revision {r.get('id', 'unnamed')}: status 'passed' requires functional, experience and performance assessments")
    records = list(state.get("stages", {}).values()) + (revisions if isinstance(revisions, list) else [])
    for record in records:
        if not isinstance(record, dict):
            continue
        assessments = record.get("assessments", {})
        if not isinstance(assessments, dict):
            continue
        for name, assessment in assessments.items():
            if not isinstance(assessment, dict):
                continue
            status = assessment.get("status")
            if status in ("passed", "failed") and not assessment.get("evidence"):
                errors.append(f"{name}: evaluated assessment requires evidence")
            if status in ("not_evaluated", "not_applicable") and not assessment.get("reason"):
                errors.append(f"{name}: unevaluated/inapplicable assessment requires reason")
            if record.get("status") == "passed" and (status == "failed" or name in ("functional", "experience") and status == "not_evaluated"):
                errors.append(f"{name}: unresolved assessment cannot accompany passed record")
    return errors


def gate_lines(stage):
    """The stage's gate commands as printable lines, or a line saying it has none.

    Reported next to the prompt because a stage that names what to read but not how it is
    verified leaves the reader to guess -- and a gate nobody runs is a gate that does not exist.
    """
    gates = STAGE_GATES.get(stage, ())
    if not gates:
        return "  gate: none automated for this stage yet."
    body = "\n".join(f"    {command}" for command in gates)
    label = "gate:" if len(gates) == 1 else f"gates ({len(gates)}, in order):"
    return f"  {label}\n{body}"


def stage_artifact(state, stage, state_path):
    """Resolve the artifact explicitly named by a validated completed stage."""
    return (Path(state_path).resolve().parent / state['stages'][stage]['artifact']).resolve()


def next_step(state, state_path=None):
    """Return (message, exit_code) for the exact next action, given a valid state."""
    for revision in state.get("revisions", []):
        if revision["status"] == "in_progress":
            if revision["loop_count"] >= LOOP_CAP:
                return (f"Revision {revision['id']} hit the loop cap ({LOOP_CAP}). Stop and report.", 3)
            gates = "\n".join(gate_lines(stage) for stage in revision["affected_stages"])
            return (f"Revision {revision['id']}: {revision['request']}\n"
                    f"Regressions: {', '.join(revision['regressions'])}\n"
                    f"Parameters: {revision['parameter_source']}\n{gates}", 0)
    current = state["current_stage"]
    if current == "done":
        return ("Pipeline complete — no further steps.", 0)

    if current not in STAGES:
        return (f"unknown current_stage {current!r}", 1)

    record = state["stages"][current]
    status = record["status"]
    loop = record["loop_count"]
    prompt = STAGE_PROMPTS[current]
    gates = gate_lines(current)

    if status in ("passed",):
        idx = STAGES.index(current)
        next_stage = STAGES[idx + 1] if idx + 1 < len(STAGES) else "done"
        verb = "passed"
        artifact = stage_artifact(state, current, state_path) if state_path else record['artifact']
        provenance = f"\n  verified artifact: {artifact}"
        if current in STAGES[1:-1]:
            action = ("  resume the recorded finish.py review, or run "
                      f"forge/scaffold.py advance --project-root <output> --from-stage {current} --name {next_stage}.")
        else:
            action = "  resume the recorded finish.py review to update current_stage."
        return (
            f"Stage `{current}` is {verb}. Next: `{next_stage}`.\n"
            f"{action}{provenance}",
            0,
        )

    if status == "in_progress":
        if loop >= LOOP_CAP:
            return (
                f"Stage `{current}` hit the loop cap ({LOOP_CAP}). Stop — do not refine further.",
                3,
            )
        return (
            f"Stage `{current}` in progress (loop {loop}/{LOOP_CAP}). "
            f"Continue: read `{prompt}`.\n  closeout: forge/finish.py --project-root <output> --check\n{gates}",
            0,
        )

    if status == "not_started":
        return (f"Stage `{current}` not started. Begin: read `{prompt}`.\n"
                f"  closeout: forge/finish.py --project-root <output> --check\n{gates}", 0)

    return (f"unknown status {status!r} for stage `{current}`", 1)
