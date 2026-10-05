"""Run stage gates, then record an explicit review and advance without rerunning them.

Use --check to generate evidence and a review template; use --review with that
completed template to commit the stage. Revisions and custom/manual checks retain
the low-level workflow documented in grimoire/review/gates.md.
"""
import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

from _shared.attempts import evidence_valid, file_hashes, load_ledger, sha256_file, stage_snapshot
from _shared.constants import LAUNCH_RETRY_CAP, GATE_TIMEOUT_SECONDS, LOOP_CAP, STAGES, STAGE_PROMPTS, STAGE_GATE_IDS, gate_plan
from _shared.incremental import reusable_check, report_valid, candidates
from _shared.paths import resolve_inside
from _shared.state import load_state, state_errors
from scaffold import ROOT, commit_transition, encoded, prepare_advance

FORMAT = 'gameblocks-finish/v1'
LEDGER_CHECKS = {'scene': 'step1', 'behavior': 'step2', 'closure': 'step2-closure', 'acceptance': 'step3'}
# Stages whose gates drive a real-input strategy card.
STRATEGY_STAGES = ('behavior', 'acceptance')


def read_object(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'expected a JSON object: {path}')
    return value


def relative(root, path):
    return resolve_inside(root, path, 'path').relative_to(root).as_posix()


def evidence_path(root, value):
    path = resolve_inside(root, value, 'evidence')
    if 'evidence' not in path.relative_to(root).parts:
        raise ValueError('keep closeout files under evidence/ so reviews do not change source hashes')
    return path


def read_state(root):
    state = load_state(resolve_inside(root, '.state.json', 'state'))
    errors = state_errors(state)
    if errors:
        raise ValueError('; '.join(errors))
    if any(row['status'] == 'in_progress' for row in state.get('revisions', [])):
        raise ValueError('an active revision must use the revision workflow; stage history is preserved')
    return state


def latest_path(root, stage):
    return evidence_path(root, f'evidence/finish/{stage}/latest.json')


def spend_round(root, stage):
    """Charge one correction cycle to a failed batch and return the new count.

    State is reloaded so a concurrent edit is not clobbered, and revalidated so a
    spent round cannot leave an invalid record. The count saturates at the cap:
    the next batch is refused rather than silently exceeding it.
    """
    state = read_state(root)
    record = state['stages'][stage]
    record['loop_count'] = min(LOOP_CAP, record['loop_count'] + 1)
    errors = state_errors(state)
    if errors:
        raise ValueError('; '.join(errors))
    commit_transition(root, state, {})
    return record['loop_count']


def latest_attempt(root, gate, run):
    check_id = LEDGER_CHECKS.get(gate)
    if not check_id:
        return None
    run = Path(run)
    return next((row for row in reversed(load_ledger(root)['attempts'])
                 if row['check'] == f'{check_id}:{run.name}'
                 and (not row.get('binding') or row['binding']['run'] == relative(root, run))), None)


def inputs(root, run, stage, extra):
    current = stage_snapshot(root, run, extra, kind='runtime')
    artifacts, shared = current
    if run.is_dir():
        # Metadata validators consume the current card, including non-runtime fields.
        artifacts.update(file_hashes(root, run.glob('step[1-3].json')))
    return {'artifact': artifacts, 'shared': shared, 'binding': current.binding}


def run_gate(argv, root, log):
    with log.open('w', encoding='utf-8') as stream:
        try:
            result = subprocess.run(argv, cwd=root, stdout=stream, stderr=subprocess.STDOUT,
                                    timeout=GATE_TIMEOUT_SECONDS)
            return result.returncode
        except OSError as exc:
            stream.write(f'\n{type(exc).__name__}: {exc}\n')
            return None  # Process never started; no game verdict is available.
        except subprocess.TimeoutExpired as exc:
            stream.write(f'\n{type(exc).__name__}: {exc}\n')
            return 1


def check(root, *, stage=None, artifact=None, strategy=None, options=(), force=False):
    """Run one bounded gate batch; evaluated failures spend a refinement round.

    Stage status, artifact and evidence stay untouched: a batch never advances or
    records a pass. A failed batch is the one correction cycle the recovery
    workflow counts, so it charges `loop_count`; process-launch failures remain
    unevaluated under a separate consecutive retry cap. The receipt reports the count
    and state hash it leaves behind.
    """
    root = root.resolve()
    state = read_state(root)
    stage = stage or state['current_stage']
    if stage not in STAGES or stage != state['current_stage']:
        raise ValueError('check requires the current unfinished stage')
    record = state['stages'][stage]
    if record['status'] not in ('in_progress', 'not_started'):
        raise ValueError('stage already recorded; resume its closeout or use scaffold advance')
    run = resolve_inside(root, artifact or record.get('artifact', 'brief.json' if stage == 'intake' else ''), 'artifact')
    if stage == 'intake':
        if not run.is_file():
            raise ValueError('intake needs the brief file')
    elif not run.is_dir() or not (run / 'index.html').is_file():
        raise ValueError('stage needs a retained runnable artifact (--artifact if absent from state)')
    if stage == 'acceptance' and run.parent != root / 'runs/step3':
        raise ValueError('acceptance relocation requires the run under runs/step3')
    if stage in STRATEGY_STAGES and not strategy:
        raise ValueError(f'{stage} requires --strategy with the real-input playthrough')
    extra = [resolve_inside(root, strategy, 'strategy')] if strategy else []
    if any(not path.is_file() for path in extra):
        raise ValueError('strategy must be an existing file')
    pointer = latest_path(root, stage)
    previous = read_object(pointer) if pointer.is_file() else None
    previous_receipt = read_object(evidence_path(root, previous['receipt'])) if previous else {}
    launch_failures = previous_receipt.get('launch_failures', 0)
    if launch_failures >= LAUNCH_RETRY_CAP:
        raise ValueError('process-launch retry cap reached; retain logs and use manual recovery after repairing the environment')
    if (record['loop_count'] >= LOOP_CAP and previous
            and read_object(evidence_path(root, previous['receipt'])).get('loop_count', LOOP_CAP) >= LOOP_CAP):
        raise ValueError('loop cap reached; finish the passing third-round review or stop')
    before = inputs(root, run, stage, extra)
    folder = evidence_path(root, (root if stage == 'intake' else run) / 'evidence/finish' / uuid.uuid4().hex[:12])
    receipt_path = folder / 'checks.json'
    values = {'root': str(root), 'run': str(run), 'runs': str(run.parent), 'name': run.name,
              'output': relative(root, folder), 'strategy': str(extra[0]) if extra else ''}
    reused_checks = {}
    gates = list(STAGE_GATE_IDS[stage])
    if not force:
        for gate in ('scene', 'behavior', 'closure'):
            if gate in gates:
                # The closure gate replays the strategy, so its reuse must bind that file too.
                row = reusable_check(root, run, gate, options, extra if gate == 'closure' else ())
                if row:
                    reused_checks[gate] = row
    plan = gate_plan(stage, values, sys.executable, str(ROOT / 'forge'), options, gates)
    receipt = {'format': FORMAT, 'stage': stage, 'artifact': relative(root, run),
               'stateSha256': sha256_file(root / '.state.json'), 'loop_count': record['loop_count'], 'inputs': before,
               'extra': [relative(root, path) for path in extra], 'checks': [], 'status': 'passed',
               'verification': 'reused-identical' if reused_checks else 'stage-check'}
    evidence = []
    # Publish an incomplete batch before executing, so an interruption cannot revive
    # an older green batch. Planning errors above leave the previous pointer intact.
    folder.mkdir(parents=True, exist_ok=False)
    receipt_path.write_bytes(encoded({**receipt, 'status': 'not_evaluated'}))
    pointer.parent.mkdir(parents=True, exist_ok=True)
    pointer.write_bytes(encoded({'receipt': relative(root, receipt_path)}))
    for gate, argv, report_value in plan:
        log = folder / f'{gate}.log'
        report_path = resolve_inside(root, report_value, 'report') if report_value else None
        # Reuse init's schema-only evidence only while it matches this exact brief.
        initial = root / 'evidence/brief-validation.json'
        reused = False
        cached = reused_checks.get(gate)
        if cached:
            report_path = root / cached['binding']['report']
            reused = True
        if gate == 'brief' and initial.is_file():
            result = read_object(initial)
            reused = (result.get('status') == 'passed' and result.get('check') == 'brief schema only'
                      and result.get('briefSha256') == sha256_file(run))
        if reused:
            log.write_text('Reused matching dependency-bound evidence; scope and experience reviews remain required.\n')
            if gate == 'brief':
                report_path = initial
            code = 0
        else:
            code = run_gate(argv, root, log)
        if code is None:
            receipt.update(status='not_evaluated', launch_failures=launch_failures + 1,
                           error='gate process could not start; repair the environment before retrying')
            receipt['checks'].append({'id': gate, 'argv': argv, 'returncode': None,
                                      'reused': False, 'status': 'not_evaluated', 'log': relative(root, log)})
            evidence.append(relative(root, log))
            break
        passed = code == 0
        row = {'id': gate, 'argv': argv, 'returncode': code, 'reused': reused}
        if report_path and report_path.is_file():
            result = read_object(report_path)
            if gate in LEDGER_CHECKS:
                passed &= result.get('functional', {}).get('status') == 'passed'
            if gate in ('relocation', 'brief'):
                passed &= result.get('status') == 'passed'
            retained = folder / f'{gate}-report.json'
            retained.write_bytes(report_path.read_bytes())
            row['report'] = relative(root, retained)
            evidence.append(row['report'])
        elif report_path:
            passed = False
        if gate in LEDGER_CHECKS:
            attempt = cached or latest_attempt(root, gate, run)
            expected_result = 'passed'
            passed &= bool(attempt and attempt['result'] == expected_result and report_path and report_path.is_file()
                           and attempt['artifact'].get(relative(root, report_path)) == sha256_file(report_path))
            row['attempt'] = attempt
            if cached:
                row['sourceRun'] = cached['binding']['run']
        row['status'] = 'passed' if passed else 'failed'
        row['log'] = relative(root, log)
        evidence.append(row['log'])
        receipt['checks'].append(row)
        if not passed:
            receipt['status'] = 'failed'
            break
    if inputs(root, run, stage, extra) != before:
        receipt.update(status='failed', error='artifact or dependencies changed during checks')
    receipt['evidence'] = evidence
    # Spend the round before publishing the receipt, so a crash between the two
    # charges the cycle instead of hiding it. A batch interrupted earlier stays
    # unevaluated and repeatable; a passing batch spends nothing.
    if receipt['status'] == 'failed':
        receipt['loop_count'] = spend_round(root, stage)
        receipt['stateSha256'] = sha256_file(root / '.state.json')
    # checks.json and review.json are mutable closeout envelopes; hash only the
    # generated gate evidence so writing the final receipt/review cannot make a
    # valid batch stale by changing its own checksum.
    receipt['outputs'] = file_hashes(root, [path for path in folder.rglob('*')
                                           if path.is_file() and path != receipt_path])
    receipt_path.write_bytes(encoded(receipt))
    review = {'receipt': {'path': relative(root, receipt_path), 'sha256': sha256_file(receipt_path)}}
    if stage == 'intake':
        review['intent'] = {'status': 'not_evaluated', 'reason': ''}
    else:
        review['experience'] = {'status': 'not_evaluated', 'evidence': [], 'reason': ''}
        review['performance'] = {'status': 'not_evaluated', 'evidence': [], 'reason': ''}
    review_path = folder / 'review.json'
    review_path.write_bytes(encoded(review))
    return review_path


def assessment(root, value, label):
    if not isinstance(value, dict) or not isinstance(value.get('reason'), str) or not value['reason'].strip():
        raise ValueError(f'{label} needs an explicit review reason or observations')
    paths = value.get('evidence', [])
    if not isinstance(paths, list) or not all(isinstance(p, str) and p.strip() for p in paths):
        raise ValueError(f'{label}.evidence must be a list of paths')
    for path in paths:
        if not resolve_inside(root, path, 'review evidence').is_file():
            raise ValueError(f'{label} evidence is missing: {path}')
    return {**value, 'evidence': [relative(root, path) for path in paths]}


def finish(root, review_value, stage=None, name=None, record_only=False):
    """Consume a current check receipt and review; retrying a committed review is a no-op."""
    root = root.resolve()
    state = read_state(root)
    review_path = evidence_path(root, review_value)
    review = read_object(review_path)
    binding = review.get('receipt', {})
    receipt_path = evidence_path(root, binding['path'])
    if sha256_file(receipt_path) != binding.get('sha256'):
        raise ValueError('check receipt changed; rerun --check')
    receipt = read_object(receipt_path)
    stage = stage or receipt['stage']
    if receipt.get('format') != FORMAT or stage != receipt['stage'] or stage not in STAGES:
        raise ValueError('invalid check receipt or stage')
    completion_path = receipt_path.parent / 'finished.json'
    recorded_path = receipt_path.parent / 'recorded.json'
    existing = completion_path if completion_path.is_file() else recorded_path
    completion = read_object(existing) if existing.is_file() else None
    record = state['stages'][stage]
    if completion:
        if (completion['reviewSha256'] != sha256_file(review_path) or record != completion['record']):
            raise ValueError('completed review or stage record changed; preserve history and use the revision workflow')
        if completion['advanced'] or record_only:
            return root / completion['nextArtifact'] if completion['nextArtifact'] else None
    if state['current_stage'] != stage:
        raise ValueError('review does not belong to the current stage')
    # A superseded batch is named before the state hash it no longer matches: a
    # later batch spends a round, so the generic hash message would hide the cause.
    if read_object(latest_path(root, stage)).get('receipt') != relative(root, receipt_path):
        raise ValueError('a newer check exists; use its review, including any unresolved failure')
    if not completion and sha256_file(root / '.state.json') != receipt['stateSha256']:
        raise ValueError('state changed after checks; rerun --check or use the manual workflow')
    if receipt['status'] != 'passed':
        raise ValueError('checks failed or remain unevaluated; inspect their reports before refinement')
    run = resolve_inside(root, receipt['artifact'], 'artifact')
    if inputs(root, run, stage, receipt['extra']) != receipt['inputs']:
        raise ValueError('artifact or dependencies changed after checks; rerun --check')
    if file_hashes(root, receipt['outputs']) != receipt['outputs']:
        raise ValueError('check evidence changed or is missing; rerun --check')
    for row in receipt['checks']:
        if row.get('reused') and 'sourceRun' in row and next(candidates(root, run, row['id']), None) != row['attempt']:
            raise ValueError('newer or invalid gate attempt exists on this artifact branch')
        if 'attempt' in row and latest_attempt(root, row['id'], root / row.get('sourceRun', receipt['artifact'])) != row['attempt']:
            raise ValueError('newer gate attempt exists; do not reuse an earlier result')
        valid = report_valid(root, row['attempt']) if row.get('reused') and 'sourceRun' in row else (
            evidence_valid(root, row['attempt']) if 'attempt' in row else True)
        if not valid:
            raise ValueError('gate evidence dependencies changed; rerun --check')
    allowed = {'receipt'} | ({'intent'} if stage == 'intake' else {'experience', 'performance'})
    if set(review) != allowed:
        raise ValueError(f'review fields must be: {", ".join(sorted(allowed))}')
    accepted = receipt_path.parent / 'accepted-review.json'
    evidence = list(dict.fromkeys([*record['evidence'], *receipt['evidence'],
                                   relative(root, receipt_path), relative(root, accepted)]))
    record.update(status='passed', artifact=receipt['artifact'], evidence=evidence)
    if stage == 'intake':
        intent = review['intent']
        if not isinstance(intent, dict) or intent.get('status') != 'passed' or not isinstance(intent.get('reason'), str) or not intent['reason'].strip():
            raise ValueError('intent needs a passed review with observations comparing the brief to the request')
    else:
        record.pop('reason', None)
        record['assessments'] = {
            'functional': {'status': 'passed', 'evidence': receipt['evidence']},
            'experience': assessment(root, review['experience'], 'experience'),
            'performance': assessment(root, review['performance'], 'performance'),
        }
    files, destination = {}, None
    if not record_only:
        if stage == 'intake':
            state['current_stage'] = 'scene'
            state['stages']['scene']['status'] = 'in_progress'
        elif stage == 'acceptance':
            state['current_stage'] = 'done'
        else:
            destination, files = prepare_advance(root, name or STAGES[STAGES.index(stage) + 1], stage, state)
    errors = state_errors(state)
    if errors:
        raise ValueError('; '.join(errors))
    completion = {'reviewSha256': sha256_file(review_path), 'record': record,
                  'advanced': not record_only, 'nextArtifact': relative(root, destination) if destination else None}
    files[relative(root, accepted)] = encoded(review)
    files[relative(root, recorded_path if record_only else completion_path)] = encoded(completion)
    commit_transition(root, state, files, destination)
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', required=True, type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true', help='run gates and print the generated review path')
    mode.add_argument('--review', help='completed review template; records and advances without rerunning gates')
    parser.add_argument('--stage', choices=STAGES)
    parser.add_argument('--artifact', help='current run, if absent from state')
    parser.add_argument('--strategy', help='real-input strategy for behavior closure or Stage 3 acceptance')
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--sim-seconds', type=float)
    parser.add_argument('--hardware', action='store_true')
    parser.add_argument('--force', action='store_true', help='rerun even identical stage evidence')
    parser.add_argument('--name', help='next run slug; defaults to the next stage ID')
    parser.add_argument('--record-only', action='store_true', help='record without advancing; resubmit the same review to advance')
    args = parser.parse_args(argv)
    try:
        if args.check:
            if args.name or args.record_only:
                raise ValueError('--name and --record-only apply to --review')
            options = [(flag, value) for flag, value in (('--width', args.width), ('--height', args.height),
                       ('--sim-seconds', args.sim_seconds)) if value is not None]
            if args.hardware:
                options.append(('--hardware', None))
            path = check(args.project_root, stage=args.stage, artifact=args.artifact, strategy=args.strategy, options=options, force=args.force)
            review = read_object(path)
            receipt = read_object(args.project_root.resolve() / review['receipt']['path'])
            checks = [{key: row[key] for key in ('id', 'status', 'report', 'log', 'reused') if key in row}
                      for row in receipt['checks']]
            print(json.dumps({'status': receipt['status'], 'stage': receipt['stage'], 'review': str(path),
                              'checks': checks, **({'error': receipt['error']} if 'error' in receipt else {})}, indent=2))
            return 0 if receipt['status'] == 'passed' else 1
        if any(value is not None for value in (args.artifact, args.strategy, args.width, args.height, args.sim_seconds)) or args.hardware or args.force:
            raise ValueError('check settings apply to --check; changing them requires a new check')
        finish(args.project_root, args.review, args.stage, args.name, args.record_only)
        state = load_state(args.project_root.resolve() / '.state.json')
        current = STAGES[-1] if state['current_stage'] == 'done' else state['current_stage']
        artifact = state['stages'][current].get('artifact')
        print(json.dumps({'current_stage': state['current_stage'],
                          'artifact': str(resolve_inside(args.project_root.resolve(), artifact, 'artifact')) if artifact else None,
                          'prompt': STAGE_PROMPTS.get(state['current_stage'])}, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
