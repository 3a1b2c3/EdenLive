"""Query the compact factory index or one factory's schema; validate real options."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='write JSON here instead of stdout')
    parser.add_argument('--factory', help='factory name or unambiguous case-insensitive fragment')
    parser.add_argument('--options', help='JSON options to validate through the factory normalizer')
    args = parser.parse_args(argv)
    if args.options is not None and not args.factory:
        parser.error('--options requires --factory')
    if args.options is not None:
        try:
            value = json.loads(args.options)
            if not isinstance(value, dict):
                raise ValueError('options must be a JSON object')
        except ValueError as exc:
            print(f'error: {exc}', file=sys.stderr)
            return 2
    script = Path(__file__).with_suffix('.mjs')
    command = ['node', str(script)]
    if args.output: command.extend(['--output', str(args.output.resolve())])
    if args.factory: command.extend(['--factory', args.factory])
    if args.options is not None: command.extend(['--options', args.options])
    try:
        return subprocess.run(command, check=False).returncode
    except OSError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
