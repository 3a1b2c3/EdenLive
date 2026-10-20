"""Read .state.json and print the exact next step (the skill's state gate).

Contract: --help; never mutate state — next.py only reads and reports; the on-disk state is
authoritative, never rebuild progress from chat history.

Exit codes:
    0  printed the next step (or pipeline complete)
    1  .state.json invalid (schema or gate invariant)
    2  usage / I/O error
    3  hard loop cap reached — stop, do not continue
"""

import argparse
import json
import sys
from pathlib import Path

from _shared.state import load_state, next_step, state_errors
from task_packet import build_task_packet


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Report the exact next pipeline step.")
    parser.add_argument(
        "state", nargs="?", default=".state.json", help="path to .state.json (default: .state.json)"
    )
    parser.add_argument(
        "--task-packet", action="store_true",
        help="print a compact JSON packet with current paths, selection, gates and closeout",
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
        return 1

    if args.task_packet:
        try:
            packet = build_task_packet(path.resolve().parent, state)
            print(json.dumps(packet, indent=2, ensure_ascii=False))
            return packet["exit_code"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    message, code = next_step(state, path)
    print(message)
    return code


if __name__ == "__main__":
    sys.exit(main())
