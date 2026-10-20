"""Choose reusable evidence without granting a broader result than was checked."""
import json
from pathlib import Path

from _shared.attempts import Snapshot, load_ledger, sha256_file
from _shared.check_dependencies import equivalent, snapshot
from _shared.paths import resolve_inside

CHECK_IDS = {'scene': 'step1', 'behavior': 'step2', 'closure': 'step2-closure', 'acceptance': 'step3'}
# Gates that replay a strategy in the browser; their settings include play budgets.
PLAYTHROUGH_GATES = ('closure', 'acceptance')

def settings(gate, options=()):
    values = dict(options)
    bound = {'width': values.get('--width', 960),
             'height': values.get('--height', 640 if gate in PLAYTHROUGH_GATES else 600),
             'hardware': '--hardware' in values,
             'device_scale_factor': 2}
    if gate in PLAYTHROUGH_GATES:
        bound.update(sim_seconds=values.get('--sim-seconds'), wall_seconds=60)
    else:
        bound['settle_ms'] = 200
    return bound


def ancestors(root, run):
    """Only follow retained source provenance, never search unrelated games by name."""
    seen = set()
    while run not in seen:
        seen.add(run)
        yield run
        path = run / 'source-artifact.json'
        if not path.is_file():
            return
        provenance = json.loads(path.read_text())
        run = resolve_inside(root, provenance['artifact'], 'source artifact')


def candidates(root, run, gate):
    ledger = load_ledger(root)['attempts']
    for source in ancestors(root, run):
        check = f'{CHECK_IDS[gate]}:{source.name}'
        # Unbound attempts are barriers, never reusable proof.
        row = next((row for row in reversed(ledger) if row['check'] == check
                    and (not row.get('binding') or row['binding']['run'] == source.relative_to(root).as_posix())), None)
        if row is None:
            continue
        if row['result'] != 'passed' or not report_valid(root, row):
            return
        binding = row.get('binding')
        if not binding or binding['kind'] != gate or binding['uncertain']:
            return
        yield row
        # Newest evidence for this branch is authoritative even if it no longer matches.
        return


def report_valid(root, row):
    """Retained proof may be historical; its inputs are compared against the target separately."""
    value = row.get('binding', {}).get('report')
    if not value:
        return False
    try:
        path = resolve_inside(root, value, 'retained report')
        report = json.loads(path.read_text())
        return (sha256_file(path) == row['artifact'].get(value)
                and report.get('functional', {}).get('status') == 'passed')
    except (OSError, ValueError, TypeError):
        return False


def recorded_snapshot(row):
    binding = dict(row['binding'])
    inputs = binding.pop('inputs')
    binding.pop('report', None)
    return Snapshot(*inputs, binding)


def reusable_check(root, run, gate, options=(), extra=()):
    """Match a recorded pass against the current inputs, including the strategy.

    Playthrough gates bind their strategy file, so changed keys, conditions or click
    targets make an earlier pass stale instead of reusable.
    """
    current = snapshot(root, run, extra, kind=gate, settings=settings(gate, options))
    for row in candidates(root, run, gate):
        if equivalent(recorded_snapshot(row), current):
            return row
    return None
