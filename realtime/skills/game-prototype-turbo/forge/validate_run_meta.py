"""Validate a stage run card against docs/specs/run-meta.schema.json (fail closed).

The run card is the metadata each stage writes beside its run for the review viewer
(forge/serve_step.py) and the stage checkers. Validate authoring drafts before browser checks.

Contract: --help; non-zero exit + printed reason on failure; no network; reads the schema
from docs/specs/ and the card from an explicit path. One dependency: jsonschema
(requirements.txt).

Usage:
    python forge/validate_run_meta.py <path-to-step1.json>

Exit codes:
    0  the card is valid
    1  the card violates run-meta.schema.json (fail closed)
    2  usage or I/O error (bad path, invalid JSON)
"""

import argparse
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "docs" / "specs" / "run-meta.schema.json"


def load_schema():
    """Read the run-meta schema from docs/specs/."""
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_meta(meta):
    """Return the list of ValidationError for ``meta``; empty means valid."""
    validator = Draft7Validator(load_schema())
    return sorted(validator.iter_errors(meta), key=lambda e: list(e.path))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a run card against run-meta.schema.json (fail closed)."
    )
    parser.add_argument("meta", help="path to the step1.json, step2.json or step3.json card to validate")
    args = parser.parse_args(argv)

    meta_path = Path(args.meta)
    if not meta_path.is_file():
        print(f"error: not a file: {meta_path}", file=sys.stderr)
        return 2

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON in {meta_path}: {exc}", file=sys.stderr)
        return 2

    errors = validate_meta(meta)
    if errors:
        for err in errors:
            location = ".".join(str(part) for part in err.path) or "<root>"
            print(f"{meta_path}: {location}: {err.message}", file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    print(f"{meta_path}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
