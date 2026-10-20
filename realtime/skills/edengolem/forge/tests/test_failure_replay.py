"""Failure handoff through real controls and brief-derived input/state fixtures.

The fixtures cover evidence transport, not implementations or solutions of the briefs.
"""
import copy
import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import check_step3
from _shared.attempts import sha256_file
from gate_fixtures import MENU_GAME, MENU_STRATEGY, fixture_run
from validate_game_brief import validate_brief

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.slow
def test_saved_failure_recipe_reproduces_then_verifies_the_fix(tmp_path):
    # A normal route confirmation fails only after a real restart. Keep that history.
    broken = MENU_GAME['main.js'].replace(
        'if (event.repeat) return;',
        "if (event.repeat) return; if (roundId === 2 && event.key === 'Enter') return;")
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps(MENU_STRATEGY))
    output = tmp_path / 'failure evidence'
    with fixture_run('failure-recipe', run_name='menu', **{'main.js': broken}) as (runs, run):
        assert check_step3.main([
            '--runs', runs.relative_to(ROOT).as_posix(), '--only', 'menu',
            '--strategy', str(strategy), '--output', str(output), '--wall-seconds', '2',
            '--width', '800', '--height', '600',
        ]) == 1
        report_path = output / 'report.json'
        original_report = report_path.read_bytes()
        report = json.loads(original_report)
        assert [s['status'] for s in report['scenarios']] == ['passed', 'failed']
        assert report['failure']['scenario'] == 2 and report['failure']['phase'] == 'terminal'
        assert report['failure']['reproduction'] == 'not_attempted'
        scenario = report['scenarios'][1]
        assert scenario['before']['state'] == 'WON' and scenario['start']['state'] == 'RUNNING'
        assert scenario['previousRoundId'] != scenario['start']['roundId']
        assert scenario['lastObservation']['state'] == 'RUNNING'
        assert [row['action']['key'] for row in scenario['inputTrace'] if 'key' in row['action']] == ['r', 'Enter']
        assert all(row['status'] == 'dispatched' for row in scenario['inputTrace'])
        assert report['inputs']['files']['main.js'] == sha256_file(run / 'main.js')
        assert report['replay']['settings']['viewport'] == {'width': 800, 'height': 600}
        saved_strategy = Path(report['replay']['strategyCopy'])
        assert saved_strategy.read_bytes() == strategy.read_bytes()
        assert sha256_file(saved_strategy) == report['replay']['strategySha256']

        # Losing or changing the author's strategy must not change the stored recipe.
        strategy.write_text('{}')
        command = report['replay']['argv']
        repeated = subprocess.run(command, cwd=tmp_path, capture_output=True, text=True, timeout=45)
        assert repeated.returncode == 1, repeated.stdout + repeated.stderr
        repeat_dir = Path(command[command.index('--output') + 1])
        repeat = json.loads((repeat_dir / 'report.json').read_text())
        assert repeat['failure']['scenario'] == 2
        assert repeat['failure']['reason'] == report['failure']['reason']

        (run / 'main.js').write_text(MENU_GAME['main.js'])
        retest = repeat['replay']['argv']
        fixed = subprocess.run(retest, cwd=tmp_path, capture_output=True, text=True, timeout=45)
        assert fixed.returncode == 0, fixed.stdout + fixed.stderr
        fixed_dir = Path(retest[retest.index('--output') + 1])
        fixed_report = json.loads((fixed_dir / 'report.json').read_text())
        assert [s['status'] for s in fixed_report['scenarios']] == ['passed'] * 3
        assert fixed_report['inputs']['files']['main.js'] != report['inputs']['files']['main.js']
        assert 'failure' not in fixed_report
        assert report_path.read_bytes() == original_report


@pytest.mark.slow
@pytest.mark.parametrize('problem', ['observation', 'restart', 'browser-error'])
def test_failure_keeps_completed_rounds_and_partial_inputs(tmp_path, problem):
    source = MENU_GAME['main.js']
    plan = copy.deepcopy(MENU_STRATEGY)
    if problem == 'observation':
        # The first real move succeeds; the dependent observation then becomes invalid.
        source = source.replace('      terminalCount,', '      terminalCount: parts.menu.index === 1 ? -1 : terminalCount,')
    elif problem == 'restart':
        source = source.replace("else if (event.key.toLowerCase() === 'r') reset();", 'else if (event.key.toLowerCase() === \'r\') void 0;')
    else:
        source = source.replace('parts.move(1);', "{ parts.move(1); throw new Error('move handler failed'); }")
    assert source != MENU_GAME['main.js']
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps(plan))
    output = tmp_path / 'evidence'
    with fixture_run('partial-failure', run_name='menu', **{'main.js': source}) as (runs, _):
        assert check_step3.main([
            '--runs', runs.relative_to(ROOT).as_posix(), '--only', 'menu',
            '--strategy', str(strategy), '--output', str(output), '--wall-seconds', '2',
        ]) == 1
    report = json.loads((output / 'report.json').read_text())
    record = report['scenarios'][-1]
    assert record['inputTrace'] and report['failure']['inputSequence'] > 0
    if problem == 'restart':
        assert report['failure']['phase'] == 'restart'
        assert report['scenarios'][0]['status'] == 'passed'
        assert record['inputTrace'][-1]['action'] == {'type': 'tap', 'key': 'r'}
        assert record['afterFailure']['roundId'] == record['previousRoundId']
    else:
        assert report['failure']['phase'] == 'play'
        assert record['inputTrace'][3]['action']['key'] == 'ArrowDown'
        if problem == 'observation':
            assert record['lastObservation']['terminalCount'] == -1
        else:
            assert any('move handler failed' in e for e in report['errors'])


class InputPage:
    """No observation API: the recorder must reuse the decision already available."""
    def __init__(self, fail_on=None):
        self.calls = []
        def send(kind, value=None, **kwargs):
            self.calls.append((kind, value, kwargs))
            if kind == fail_on:
                raise RuntimeError('input transport disconnected')
        self.keyboard = SimpleNamespace(down=lambda k: send('down', k), up=lambda k: send('up', k))
        self.mouse = SimpleNamespace(
            move=lambda x, y: send('move', (x, y)), click=lambda x, y, **k: send('click', (x, y), **k),
            down=lambda **k: send('pointer_down', **k), up=lambda **k: send('pointer_up', **k))

    def wait_for_timeout(self, ms):
        self.calls.append(('wait', ms, {}))


# Each observation/rule pair exercises a different real action in a provided brief.
# Field/key choices belong to these test fixtures, not to the briefs' public contract.
CASES = [
    ('3d-platformer', {'grounded': True}, {'grounded': True}, {'type': 'tap', 'key': 'Space'}),
    ('fps-arena', {'aim': {'target': 6}}, {'aim.target': 6}, {'type': 'click', 'x': 470, 'y': 310}),
    ('endless-runner', {'gap': {'distance': 2}}, {'gap.distance': {'$lte': 2}}, {'type': 'tap', 'key': 'Space', 'hold_ms': 80}),
    ('survivors', {'gem': {'direction': 'left'}}, {'gem.direction': 'left'}, ['a']),
    ('vehicle-soccer', {'ball': {'side': 'right'}}, {'ball.side': 'right'}, ['ArrowLeft']),
    ('push-box-puzzle', {'crate': {'cell': [2, 3]}}, {'crate.cell': [2, 3]}, {'type': 'tap', 'key': 'ArrowUp'}),
    ('bomb-maze', {'blast': {'cell': [2, 3]}}, {'blast.cell': [2, 3]}, {'type': 'tap', 'key': 'Space'}),
    ('tower-defense', {'pad': {'empty': True}, 'cash': 300}, {'pad.empty': True, 'cash': {'$gte': 100}}, {'type': 'click', 'x': 160, 'y': 240}),
    ('cooking-time', {'dish': {'stage': 'plated'}}, {'dish.stage': 'plated'}, {'type': 'tap', 'key': 'e'}),
    ('creature-battle', {'mode': 'battle', 'turn': 3, 'selected': 1}, {'mode': 'battle', 'turn': 3, 'selected': 1}, {'type': 'tap', 'key': 'Enter'}),
    ('surveillance-survival', {'camera': 2, 'door': {'threat': True}}, {'camera': 2, 'door.threat': True}, {'type': 'click', 'x': 740, 'y': 500}),
    ('arcade-racing', {'road': {'turn': 'left'}}, {'road.turn': 'left'}, ['w', 'a']),
]


@pytest.mark.parametrize('brief_name,observed,condition,action', CASES, ids=[c[0] for c in CASES])
def test_failure_inputs_preserve_brief_specific_decisions(brief_name, observed, condition, action):
    brief = json.loads((ROOT / 'assets/game-briefs' / f'{brief_name}.brief.json').read_text())
    assert not validate_brief(brief)
    state = {'state': 'RUNNING', 'roundId': 'fixture-round', 'elapsed': 0,
             'frame': {'id': 7}, **observed}
    rule = {'when': condition, 'hold' if isinstance(action, list) else 'action': action}
    plan = copy.deepcopy(MENU_STRATEGY)
    plan['scenarios'][0]['rules'] = [rule]
    check_step3.validate_strategy(plan)
    page = InputPage(); trace = []; held = set(); began = time.monotonic()
    check_step3.apply_rules(page, state, plan['scenarios'][0], {}, set(), held, trace, began=began)
    expected = [{'type': 'down', 'key': key} for key in sorted(action)] if isinstance(action, list) else [action]
    assert [r['action'] for r in trace] == expected
    for row in trace:
        assert row['rules'] == [0] and row['status'] == 'dispatched'
        assert set(row['decisionObservation']) == set(condition) | {'state'}
        assert row['frameId'] == 7 and row['elapsed'] == 0
        assert row['roundId'] == 'fixture-round' and row['dispatchSeconds'] >= 0
    # Round/sequence and wall time remain useful when multiple discrete moves take zero simulation time.
    assert [r['sequence'] for r in trace] == list(range(1, len(trace) + 1))
    if isinstance(action, list):
        check_step3.apply_rules(page, state, {'rules': []}, {}, set(), held, trace, began=began)
        assert not held
        assert [r['action']['type'] for r in trace] == ['down'] * len(action) + ['up'] * len(action)
    assert json.loads(json.dumps(trace)) == trace


def test_pointer_drag_and_partial_tap_are_not_claimed_as_accepted_gameplay():
    page = InputPage(); held = set(); trace = []; began = time.monotonic()
    state = {'state': 'RUNNING', 'elapsed': 0, 'roundId': 1, 'frame': {'id': 1}}
    actions = [{'type': 'pointer_down'}, {'type': 'move', 'x': 310, 'y': 210}, {'type': 'pointer_up'}]
    for action in actions:
        check_step3.dispatch_input(page, action, held, trace, began=began, phase='play', state=state)
    assert [row['action'] for row in trace] == actions
    assert len(page.calls) == 3
    page = InputPage(fail_on='up')
    with pytest.raises(RuntimeError):
        check_step3.dispatch_input(page, {'type': 'tap', 'key': 'Space'}, held, trace,
                                   began=began, phase='play', state=state)
    assert trace[-1]['status'] == 'dispatch_incomplete'
    assert page.calls[0][0] == 'down' and trace[-1]['error']


def test_mode_handoff_releases_keys_without_requiring_inactive_mode_fields():
    page = InputPage(); held = {'w'}; trace = []
    # Exploration fields disappear during a menu battle (creature-battle brief).
    state = {'state': 'RUNNING', 'elapsed': 0, 'mode': 'battle', 'selected': 1}
    scenario = {'rules': [
        {'when': {'mode': 'explore', 'route.clear': True}, 'hold': ['w']},
        {'when': {'mode': 'battle', 'selected': 1}, 'action': {'type': 'tap', 'key': 'Enter'}},
    ]}
    check_step3.apply_rules(page, state, scenario, {}, set(), held, trace)
    assert [row['action']['type'] for row in trace] == ['up', 'tap']
    assert trace[0]['unavailableDecisionFields'] == ['route.clear']
    assert trace[1]['decisionObservation']['mode'] == 'battle'
    assert not held


@pytest.mark.slow
def test_automatic_releases_do_not_prove_player_input(tmp_path):
    # The fixture auto-commits once RAF has started. No real player operation occurred.
    source = MENU_GAME['main.js'].replace(
        'const animate = (now) => {',
        "const animate = (now) => { if (parts.director.state === 'RUNNING') { parts.move(1); parts.commit(); collect(); }")
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps(MENU_STRATEGY))
    output = tmp_path / 'evidence'
    with fixture_run('unearned-auto-win', run_name='menu', **{'main.js': source}) as (runs, _):
        assert check_step3.main([
            '--runs', runs.relative_to(ROOT).as_posix(), '--only', 'menu',
            '--strategy', str(strategy), '--output', str(output), '--wall-seconds', '2',
        ]) == 1
    report = json.loads((output / 'report.json').read_text())
    assert report['scenarios'][0]['terminal']['state'] == 'WON'
    assert 'actual input' in report['failure']['reason']
