"""Record or query content-addressed stage attempts.

Examples:
  python forge/record_attempt.py --root game --check behavior --artifact runs/step2/behavior/step2.json --result passed
  python forge/record_attempt.py --root game --check behavior --find
"""
import argparse
import json
import sys
from pathlib import Path

from _shared.attempts import record_attempt, reusable


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--check", required=True)
    parser.add_argument("--artifact", action="append", default=[])
    parser.add_argument("--dependency", action="append", default=[])
    parser.add_argument("--affected", action="append", default=[])
    parser.add_argument("--result", choices=("passed", "failed", "not_evaluated"))
    parser.add_argument("--failure")
    parser.add_argument("--cause")
    parser.add_argument("--edit")
    parser.add_argument("--retest")
    parser.add_argument("--find", action="store_true", help="find a reusable current result")
    args = parser.parse_args(argv)
    try:
        if args.find:
            entry = reusable(args.root, args.check, artifact=args.artifact or None, dependencies=args.dependency or None)
            print(json.dumps(entry, indent=2, ensure_ascii=False) if entry else "null")
            return 0
        if not args.result or not args.artifact:
            parser.error("--result and at least one --artifact are required unless --find is used")
        entry = record_attempt(args.root, check=args.check, artifact=args.artifact,
                               dependencies=args.dependency, result=args.result,
                               affected=args.affected, failure=args.failure,
                               cause=args.cause, edit=args.edit, retest=args.retest)
        print(json.dumps(entry, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
