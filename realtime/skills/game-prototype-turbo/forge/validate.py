"""Validate .state.json against docs/specs/state.schema.json + gate invariants (fail closed).

Contract: non-zero exit + printed reason on failure; unevaluated is not a pass (a stage
marked "passed" must carry evidence, "skipped" must carry a reason, loop_count is capped).

Usage:
    python forge/validate.py [path-to-state.json]
"""

import argparse
import json
import sys
from pathlib import Path

from _shared.state import load_state, state_errors


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Validate .state.json (fail closed).")
    parser.add_argument(
        "state", nargs="?", default=".state.json", help="path to .state.json (default: .state.json)"
    )
    args = parser.parse_args(argv)

    path = Path(args.state)
    if not path.is_file():
        print(f"error: not a file: {path}", file=sys.stderr)
        return 2

    try:
        state = load_state(path)
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON in {path}: {exc}", file=sys.stderr)
        return 2

    errors = state_errors(state)
    if errors:
        for error in errors:
            print(f"{path}: {error}", file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    print(f"{path}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())