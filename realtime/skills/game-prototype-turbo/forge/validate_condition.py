"""Check shared input/playthrough predicates offline, optionally against a saved snapshot."""
import argparse
import json
import sys
from pathlib import Path

from _shared.browser_input import field, matches, validate_condition


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('condition', type=Path, help='JSON object of observation paths and expected values')
    parser.add_argument('--snapshot', type=Path, help='JSON returned by __gameTest.read(); also check paths and values')
    args = parser.parse_args(argv)
    try:
        condition = json.loads(args.condition.read_text(encoding='utf-8'))
        validate_condition(condition)
        result = {'syntax': 'valid'}
        if args.snapshot:
            snapshot = json.loads(args.snapshot.read_text(encoding='utf-8'))
            # Check all paths, including ones after an early nonmatching predicate.
            for path in condition:
                field(snapshot, path)
            result['matches'] = matches(snapshot, condition)
        print(json.dumps(result))
        return 0 if result.get('matches', True) else 1
    except (OSError, ValueError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
