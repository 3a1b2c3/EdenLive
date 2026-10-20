"""Check capability-routed real inputs and local behavior.

The browser implementation is shared with the static-scene checker, but this
module binds the stage explicitly.  Keeping the wrapper here also makes direct
imports from orchestration and tests use the same behaviour as the CLI.
"""
from check_step1 import main as _check


def main(argv=None):
    return _check(argv, stage='behavior')


if __name__ == '__main__':
    raise SystemExit(main())
