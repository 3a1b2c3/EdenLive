"""Stage closeout behavior: real gates plus isolated orchestration failure fixtures."""
import json
import sys
from pathlib import Path

import pytest

import finish as closeout
from _shared.attempts import record_stage, stage_snapshot
from _shared.constants import STAGES
from _shared.incremental import settings as check_settings
from _shared.state import state_errors
from scaffold import ROOT, encoded, initialize
from test_state import reviewed_assessments


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded(value))


def state_at(root, stage, run):
    state = {'current_stage': stage, 'stages': {}}
    for candidate in STAGES:
        before = STAGES.index(candidate) < STAGES.index(stage)
        state['stages'][candidate] = {
            'status': 'passed' if before else 'in_progress' if candidate == stage else 'not_started',
            'loop_count': 0, 'evidence': ['brief.json'] if before else [],
            **({'artifact': 'brief.json' if candidate == 'intake' else str(run.relative_to(root))} if before or candidate == stage else {}),
            **({'assessments': reviewed_assessments('brief.json')} if before and candidate != 'intake' else {}),
        }
    write_json(root / '.state.json', state)
    return state


@pytest.fixture
def initialized(tmp_path, monkeypatch):
    root = tmp_path / 'game with spaces'
    with monkeypatch.context() as context:
        context.setattr('scaffold.subprocess.run', lambda *a, **k: None)
        initialize(root, 'scene', ROOT / 'assets/game-briefs/creature-battle.brief.json')
    return root


@pytest.fixture
def fake_gates(monkeypatch):
    """Synthetic reports exercise orchestration only, never certify game behavior."""
    calls = []
    failures = {}

    def run(argv, root, log):
        script = Path(argv[1]).stem
        calls.append(argv)
        log.write_text(f'fixture for {script}\n')
        if script == 'validate_run_meta':
            return failures.get('metadata', 0)
        run = root / argv[argv.index('--run') + 1] if '--run' in argv else (
            root / argv[argv.index('--runs') + 1] / argv[argv.index('--only') + 1] if '--runs' in argv else
            root / 'runs/step3/menu-board')
        if script == 'run_project':
            run = root / 'runs/step3' / argv[argv.index('--only') + 1]
        report = {'functional': {'status': 'passed'}, 'errors': []}
        report.update(failures.get(script, {}))
        if script in ('check_step1', 'check_step2'):
            path = root / argv[argv.index('--output') + 1] / f'{run.name}.json'
        else:
            output = root / argv[argv.index('--output') + 1]
            path = output if output.suffix == '.json' else output / 'report.json'
        if script == 'run_project':
            report.setdefault('status', 'passed')
        if script in ('check_step1', 'check_step2', 'check_step3'):
            extra = [argv[argv.index('--strategy') + 1]] if '--strategy' in argv else []
            check_id = script.removeprefix('check_')
            # One executor serves both playthrough scopes, so the kind and ledger ID
            # come from --scope rather than from the script name.
            kind = {'step1': 'scene', 'step2': 'behavior', 'step3': 'acceptance'}[check_id]
            if script == 'check_step3' and '--scope' in argv:
                kind = argv[argv.index('--scope') + 1]
            if kind == 'closure':
                check_id = 'step2-closure'
            report['functional'].setdefault('scope', kind)
            record_stage(root, run, f'{check_id}:{run.name}', path, report,
                         stage_snapshot(root, run, extra, kind=kind, settings=check_settings(kind)))
        else:
            write_json(path, report)
        # Even exit zero must not turn an unevaluated/failed report into a pass.
        return 0

    monkeypatch.setattr(closeout, 'run_gate', run)
    return calls, failures


def reviewed(root, path):
    review = closeout.read_object(path)
    receipt = closeout.read_object(root / review['receipt']['path'])
    if receipt['stage'] == 'intake':
        review['intent'] = {'status': 'passed', 'reason': 'Compared the full fixture request and brief; defining actions are retained.'}
    else:
        note = path.parent / 'observations.md'
        note.write_text('Fixture observation: selection and feedback agree; review represents a supplied player verdict.\n')
        review['experience'] = {'status': 'passed', 'evidence': [str(note.relative_to(root))], 'reason': 'Reviewed control feedback and presentation.'}
        review['performance'] = {'status': 'not_evaluated', 'evidence': [], 'reason': 'No required performance budget in this fixture.'}
    write_json(path, review)
    return path


def author_behavior_card(root):
    """Complete the behavior draft the way an author must before advancing.

    ``prepare_advance`` seeds blank structure and validates the source card, so a run that
    never authored its input model or checks cannot reach acceptance. The fixture supplies
    plausible values only; it certifies nothing about the game.
    """
    path = root / 'runs/step2/behavior/step2.json'
    card = closeout.read_object(path)
    card['implementation'].update(camera='Fixed board camera.', input_model='Pointer selection.')
    card['input_checks'] = [{
        'name': 'select a partner', 'actions': [{'click': '#partner-1'}],
        'expect': {'selection': 'partner-1'}, 'settle_ms': 100, 'persist_ms': 100,
    }]
    write_json(path, card)
    return path


def scene_stage(initialized):
    root = initialized
    state = closeout.read_object(root / '.state.json')
    state['current_stage'] = 'scene'
    state['stages']['intake']['status'] = 'passed'
    state['stages']['scene']['status'] = 'in_progress'
    write_json(root / '.state.json', state)
    return root


def test_intake_reuses_init_schema_but_requires_intent_review(initialized, monkeypatch):
    root = initialized
    monkeypatch.setattr(closeout, 'run_gate', lambda *args: pytest.fail('matching init evidence should be reused'))
    before = (root / '.state.json').read_bytes()
    review = closeout.check(root)
    assert (root / '.state.json').read_bytes() == before
    with pytest.raises(ValueError, match='intent'):
        closeout.finish(root, review)
    closeout.finish(root, reviewed(root, review))
    state = closeout.read_object(root / '.state.json')
    assert state['current_stage'] == 'scene'
    assert state['stages']['scene']['status'] == 'in_progress'
    assert 'evidence/brief-validation.json' in state['stages']['intake']['evidence']
    assert not state_errors(state)


def test_changed_intake_brief_runs_real_schema_check(initialized):
    root = initialized
    brief = closeout.read_object(root / 'brief.json')
    brief['core_verb'] = 'Select a partner and command its move.'
    write_json(root / 'brief.json', brief)
    review = closeout.check(root)
    receipt = closeout.read_object(root / closeout.read_object(review)['receipt']['path'])
    assert receipt['status'] == 'passed'
    assert not receipt['checks'][0]['reused']
    closeout.finish(root, reviewed(root, review))


def test_cli_routes_to_the_ready_artifact_and_keeps_receipts_on_disk(initialized, fake_gates, capsys):
    root = initialized
    paths = []
    for stage, next_stage in [('intake', 'scene'), ('scene', 'behavior')]:
        assert closeout.main(['--project-root', str(root), '--check']) == 0
        summary = json.loads(capsys.readouterr().out)
        assert summary['stage'] == stage and summary['status'] == 'passed'
        path = reviewed(root, Path(summary['review']))
        paths.append(path)
        receipt = closeout.read_object(root / closeout.read_object(path)['receipt']['path'])
        assert receipt['inputs'] and receipt['outputs']
        assert all('argv' in row for row in receipt['checks'])
        assert all('argv' not in row and 'attempt' not in row for row in summary['checks'])
        assert closeout.main(['--project-root', str(root), '--review', str(path)]) == 0
        routing = json.loads(capsys.readouterr().out)
        assert routing['current_stage'] == next_stage
        assert (Path(routing['artifact']) / 'index.html').is_file()
    assert closeout.main(['--project-root', str(root), '--review', str(paths[0])]) == 0
    routing = json.loads(capsys.readouterr().out)
    assert routing['current_stage'] == 'behavior'
    assert Path(routing['artifact']) == root / 'runs/step2/behavior'
    assert len(fake_gates[0]) == 2


def test_scene_advances_and_repeated_submission_does_not_repeat_work(initialized, fake_gates):
    root = scene_stage(initialized)
    review = reviewed(root, closeout.check(root))
    calls, _ = fake_gates
    assert [Path(argv[1]).stem for argv in calls] == ['validate_run_meta', 'check_step1']
    assert '--boot-only' not in calls[1]
    assert calls[1][calls[1].index('--project-root') + 1] == str(root)
    assert calls[1][0] == sys.executable
    expected = root / 'runs/step2/behavior'
    assert closeout.finish(root, review) == expected
    before = (root / '.state.json').read_bytes()
    assert closeout.finish(root, review) == expected
    assert (root / '.state.json').read_bytes() == before
    assert len(calls) == 2
    state = closeout.read_object(root / '.state.json')
    assert state['current_stage'] == 'behavior' and not state_errors(state)
    assert state['stages']['behavior']['evidence'] == []
    assert (expected / 'index.html').is_file()
    assert closeout.read_object(expected / 'source-artifact.json')['artifact'] == 'runs/step1/scene'
    assert not (expected / 'evidence').exists()
    assert state['stages']['scene']['assessments']['performance']['status'] == 'not_evaluated'


def test_complete_pipeline_runs_each_gate_and_finishes_with_relocation(initialized, fake_gates):
    root = initialized
    for stage in STAGES:
        strategy = None
        if stage == 'behavior':
            author_behavior_card(root)
        # Both input-driving stages supply a strategy: behaviour for its closure
        # check, acceptance for the full sequence.
        if stage in ('behavior', 'acceptance'):
            number = STAGES.index(stage)
            run = root / f'runs/step{number}/{stage}'
            write_json(run / 'strategy.json', {'fixture': 'orchestration only'})
            strategy = f'runs/step{number}/{stage}/strategy.json'
        review = reviewed(root, closeout.check(root, strategy=strategy))
        receipt = closeout.read_object(root / closeout.read_object(review)['receipt']['path'])
        assert receipt['status'] == 'passed'
        closeout.finish(root, review)
    state = closeout.read_object(root / '.state.json')
    assert state['current_stage'] == 'done' and not state_errors(state)
    assert all(state['stages'][stage]['status'] == 'passed' for stage in STAGES)
    # Behaviour now runs its capability check and then the closure playthrough; the
    # same executor serves acceptance, at its own scope.
    assert [Path(argv[1]).stem for argv in fake_gates[0]] == [
        'validate_run_meta', 'check_step1', 'check_step2', 'check_step3', 'check_step3', 'run_project']
    scopes = [argv[argv.index('--scope') + 1] if '--scope' in argv else None for argv in fake_gates[0]]
    assert scopes == [None, None, None, 'closure', None, None]
    assert '--relocate' in fake_gates[0][-1]
    for number, stage in enumerate(STAGES[1:], 1):
        run = root / f'runs/step{number}/{stage}'
        assert (run / f'step{number}.json').is_file()
        assert (run / 'scene-manifest.json').is_file()


@pytest.mark.parametrize('gate,status', [
    ('check_step2', 'not_evaluated'), ('check_step3', 'failed'), ('run_project', 'failed'),
])
def test_failed_final_gates_never_advance_even_with_zero_exit(initialized, fake_gates, gate, status):
    root = initialized
    target = 'behavior' if gate == 'check_step2' else 'acceptance'

    def stage_strategy(stage):
        """Behaviour and acceptance both drive inputs, so both need a strategy."""
        if stage not in ('behavior', 'acceptance'):
            return None
        number = STAGES.index(stage)
        write_json(root / f'runs/step{number}/{stage}/strategy.json', {'fixture': 'orchestration only'})
        return f'runs/step{number}/{stage}/strategy.json'

    while closeout.read_object(root / '.state.json')['current_stage'] != target:
        current = closeout.read_object(root / '.state.json')['current_stage']
        if current == 'behavior':
            author_behavior_card(root)
        closeout.finish(root, reviewed(root, closeout.check(root, strategy=stage_strategy(current))))
    if target == 'behavior':
        author_behavior_card(root)
    strategy = stage_strategy(target)
    fake_gates[1][gate] = ({'status': status} if gate == 'run_project'
                           else {'functional': {'status': status}})
    before = closeout.read_object(root / '.state.json')
    review = reviewed(root, closeout.check(root, strategy=strategy))
    with pytest.raises(ValueError, match='failed'):
        closeout.finish(root, review)
    # The failed batch spends its correction round; nothing else may move.
    after = closeout.read_object(root / '.state.json')
    assert after['stages'][target]['loop_count'] == before['stages'][target]['loop_count'] + 1
    for state in (before, after):
        state['stages'][target].pop('loop_count')
    assert after == before


@pytest.mark.parametrize('problem', ['missing', 'failed', 'not_evaluated', 'measured'])
def test_invalid_experience_or_performance_never_advances(initialized, fake_gates, problem):
    root = scene_stage(initialized)
    path = reviewed(root, closeout.check(root))
    review = closeout.read_object(path)
    if problem == 'missing':
        review.pop('experience')
    elif problem == 'measured':
        review['performance']['status'] = 'measured'
    else:
        review['experience']['status'] = problem
    write_json(path, review)
    before = (root / '.state.json').read_bytes()
    with pytest.raises(ValueError):
        closeout.finish(root, path)
    assert (root / '.state.json').read_bytes() == before
    assert not (root / 'runs/step2/behavior').exists()


@pytest.mark.parametrize('mutation', ['source', 'shared', 'report', 'receipt', 'missing-observation', 'state'])
def test_stale_or_missing_evidence_never_advances(initialized, fake_gates, mutation):
    root = scene_stage(initialized)
    path = reviewed(root, closeout.check(root))
    receipt_path = root / closeout.read_object(path)['receipt']['path']
    receipt = closeout.read_object(receipt_path)
    target = {'source': root / 'runs/step1/scene/main.js', 'shared': root / 'brief.json',
              'report': root / receipt['checks'][-1]['report'], 'receipt': receipt_path,
              'state': root / '.state.json', 'missing-observation': path.parent / 'observations.md'}[mutation]
    if mutation == 'missing-observation':
        target.unlink()
    else:
        target.write_bytes(target.read_bytes() + b'\n')
    before = (root / '.state.json').read_bytes()
    with pytest.raises(ValueError):
        closeout.finish(root, path)
    assert (root / '.state.json').read_bytes() == before
    assert not (root / 'runs/step2/behavior').exists()


def test_latest_failure_blocks_old_pass_and_cheap_failure_stops_browser(initialized, fake_gates):
    root = scene_stage(initialized)
    old = reviewed(root, closeout.check(root))
    calls, failures = fake_gates
    failures['metadata'] = 1
    new = closeout.check(root)
    assert len(calls) == 3
    with pytest.raises(ValueError, match='newer check'):
        closeout.finish(root, old)
    with pytest.raises(ValueError, match='failed'):
        closeout.finish(root, new)
    assert old.is_file()


def test_new_low_level_failure_blocks_previous_batch(initialized, fake_gates):
    root = scene_stage(initialized)
    path = reviewed(root, closeout.check(root))
    run = root / 'runs/step1/scene'
    record_stage(root, run, 'step1:scene', run / 'evidence/later.json',
                 {'functional': {'status': 'failed'}, 'errors': ['later failure']}, stage_snapshot(root, run))
    with pytest.raises(ValueError, match='newer gate attempt'):
        closeout.finish(root, path)


@pytest.mark.parametrize('failure', ['conflict', 'symlink', 'write', 'name'])
def test_copy_failure_keeps_state_and_all_existing_files(initialized, fake_gates, monkeypatch, failure):
    root = scene_stage(initialized)
    path = reviewed(root, closeout.check(root))
    destination = root / 'runs/step2/behavior'
    if failure == 'conflict':
        destination.mkdir()
        (destination / 'index.html').write_text('preserved')
    if failure == 'symlink':
        (root / 'runs/step1/scene/link.js').symlink_to(root / 'runs/step1/scene/main.js')
    if failure == 'write':
        original = Path.write_bytes
        def fail_write(target, data):
            if target.is_relative_to(destination) and target.name == 'step2.json':
                raise OSError('injected copy failure')
            return original(target, data)
        monkeypatch.setattr(Path, 'write_bytes', fail_write)
    before = (root / '.state.json').read_bytes()
    with pytest.raises((ValueError, OSError)):
        closeout.finish(root, path, name='../outside' if failure == 'name' else None)
    assert (root / '.state.json').read_bytes() == before
    if failure == 'conflict':
        assert (destination / 'index.html').read_text() == 'preserved'
    else:
        assert not destination.exists()
    if failure == 'write':
        monkeypatch.setattr(Path, 'write_bytes', original)
        assert closeout.finish(root, path) == destination


def test_record_only_can_later_advance_without_recheck(initialized, fake_gates):
    root = scene_stage(initialized)
    path = reviewed(root, closeout.check(root))
    assert closeout.finish(root, path, record_only=True) is None
    assert closeout.finish(root, path, record_only=True) is None
    assert closeout.read_object(root / '.state.json')['current_stage'] == 'scene'
    assert not (root / 'runs/step2/behavior').exists()
    closeout.finish(root, path)
    assert closeout.read_object(root / '.state.json')['current_stage'] == 'behavior'
    assert len(fake_gates[0]) == 2


def test_failed_batches_spend_rounds_until_the_cap_refuses_another(initialized, fake_gates):
    """A failed batch is the counted correction cycle; a passing one spends nothing."""
    root = scene_stage(initialized)
    calls, failures = fake_gates

    def loop_count():
        return closeout.read_object(root / '.state.json')['stages']['scene']['loop_count']

    passing = reviewed(root, closeout.check(root))
    assert loop_count() == 0, 'a passing batch is not a correction cycle'

    failures['metadata'] = 1
    for expected in (1, 2, 3):
        review = closeout.check(root)
        receipt = closeout.read_object(root / closeout.read_object(review)['receipt']['path'])
        assert receipt['status'] == 'failed'
        assert loop_count() == expected
        # The receipt reports the count and state it leaves behind, so a stale
        # green batch cannot be revived by resubmitting an older review.
        assert receipt['loop_count'] == expected
        assert receipt['stateSha256'] == closeout.sha256_file(root / '.state.json')
    with pytest.raises(ValueError, match='loop cap'):
        closeout.check(root)
    # The earlier pass stays unusable: its state hash and pointer are both stale.
    with pytest.raises(ValueError, match='newer check'):
        closeout.finish(root, passing)
    assert state_errors(closeout.read_object(root / '.state.json')) == []


def test_a_spent_round_leaves_stage_status_artifact_and_evidence_untouched(initialized, fake_gates):
    root = scene_stage(initialized)
    _, failures = fake_gates
    failures['metadata'] = 1
    before = closeout.read_object(root / '.state.json')
    closeout.check(root)
    after = closeout.read_object(root / '.state.json')
    assert after['stages']['scene']['loop_count'] == before['stages']['scene']['loop_count'] + 1
    for state in (before, after):
        state['stages']['scene'].pop('loop_count')
    assert after == before, 'only the spent round may change; a batch never records a pass'


def test_revision_and_loop_cap_are_preserved(initialized, fake_gates):
    root = scene_stage(initialized)
    state = closeout.read_object(root / '.state.json')
    state['stages']['scene']['loop_count'] = 3
    write_json(root / '.state.json', state)
    path = reviewed(root, closeout.check(root))
    with pytest.raises(ValueError, match='loop cap'):
        closeout.check(root)
    closeout.finish(root, path)  # A passing third round may advance.
    state = closeout.read_object(root / '.state.json')
    state['revisions'] = [{'id': 'r1', 'request': 'Change controls', 'affected_stages': ['behavior'],
                           'status': 'in_progress', 'loop_count': 0, 'evidence': [],
                           'parameter_source': 'game.mjs', 'regressions': ['behavior input']}]
    write_json(root / '.state.json', state)
    before = (root / '.state.json').read_bytes()
    with pytest.raises(ValueError, match='active revision'):
        closeout.check(root)
    with pytest.raises(ValueError, match='active revision'):
        closeout.finish(root, path)
    assert (root / '.state.json').read_bytes() == before


def test_launch_failures_are_unevaluated_and_bounded_without_spending_refinements(initialized, monkeypatch):
    root = scene_stage(initialized)
    def unavailable(argv, root, log):
        log.write_text('launch unavailable\n')
        return None
    monkeypatch.setattr(closeout, 'run_gate', unavailable)
    for count in range(1, closeout.LAUNCH_RETRY_CAP + 1):
        review = closeout.check(root)
        receipt = closeout.read_object(root / closeout.read_object(review)['receipt']['path'])
        assert receipt['status'] == 'not_evaluated'
        assert receipt['launch_failures'] == count
        assert closeout.read_object(root / '.state.json')['stages']['scene']['loop_count'] == 0
        with pytest.raises(ValueError, match='unevaluated'):
            closeout.finish(root, review)
    with pytest.raises(ValueError, match='process-launch retry cap'):
        closeout.check(root)


def test_successful_retry_clears_consecutive_launch_failures(initialized, fake_gates, monkeypatch):
    root = scene_stage(initialized)
    with monkeypatch.context() as context:
        def unavailable(argv, root, log):
            log.write_text('process unavailable\n')
            return None
        context.setattr(closeout, 'run_gate', unavailable)
        closeout.check(root)
    review = closeout.check(root)
    receipt = closeout.read_object(root / closeout.read_object(review)['receipt']['path'])
    assert receipt['status'] == 'passed'
    assert receipt.get('launch_failures', 0) == 0
    closeout.finish(root, reviewed(root, review))


@pytest.mark.parametrize('failure,expected', [(OSError('cannot launch'), None),
                                             (closeout.subprocess.TimeoutExpired('gate', 300), 1)])
def test_gate_distinguishes_launch_errors_from_timeouts(tmp_path, monkeypatch, failure, expected):
    def fail(*args, **kwargs):
        raise failure
    monkeypatch.setattr(closeout.subprocess, 'run', fail)
    log = tmp_path / 'gate.log'
    assert closeout.run_gate(['gate'], tmp_path, log) == expected
    assert type(failure).__name__ in log.read_text()
