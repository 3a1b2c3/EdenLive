"""Offline authoring helpers: drafts stay visibly unfinished and preflights stay read-only.

These cover the deterministic assistance around the pipeline, not gameplay. A draft that
validated would let an unauthored run reach a gate, so the tests assert refusal as much as
generation.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from _shared.starters import prepare_behavior_card, scene_manifest, starter_strategy
from check_step3 import validate_strategy
from scaffold import ROOT, advance, initialize
from validate_run_meta import validate_meta
from test_state import reviewed_assessments

STEP3 = ROOT / 'forge/check_step3.py'
CONDITION = ROOT / 'forge/validate_condition.py'
BRIEF = ROOT / 'assets/game-briefs/creature-battle.brief.json'


def run(script, *args):
    return subprocess.run([sys.executable, str(script), *map(str, args)], capture_output=True, text=True)


def scene_card():
    return {
        'control_scheme': 'custom', 'player_modality': 'menu', 'core_verb': 'Command a partner.',
        'modules': [], 'controls': [], 'brief': '../../../brief.json',
        'signature_actions': [], 'scene_manifest': 'scene-manifest.json', 'capabilities': [],
    }


def test_scene_manifest_covers_every_theme_element_without_binding_it():
    brief = {'scene': {'theme_elements': [{'id': 'board'}, {'id': 'partner'}]}}
    manifest = scene_manifest(brief)
    assert [row['id'] for row in manifest['elements']] == ['board', 'partner']
    assert all(row['binding'] == {} and row['asset'] == '' for row in manifest['elements'])


def test_behavior_draft_is_structured_but_cannot_pass_the_card_schema():
    card = scene_card()
    prepare_behavior_card(card, json.loads(BRIEF.read_text(encoding='utf-8')))
    assert card['implementation'] == {
        'controllers': [], 'camera': '', 'input_model': '', 'catalog_skips': [],
    }
    assert card['input_checks'] and card['signature_actions']
    assert card['signature_actions'][0]['brief_refs'] == ['/core_verb']
    # Blank camera, input model, actions and expectations must fail until authored.
    assert validate_meta(card)


def test_behavior_draft_never_replaces_authored_values():
    card = scene_card()
    card.update(
        capabilities=['custom:partner_command'],
        capability_checks={'custom:partner_command': ['partner obeys the chosen order']},
        implementation={'controllers': ['MenuSelectionController'], 'camera': 'Fixed board camera.',
                        'input_model': 'Pointer selection.'},
        input_checks=[{'name': 'choose a partner', 'actions': [{'type': 'click', 'x': 120, 'y': 80}],
                       'expect': {'selection': 'partner-1'}}],
        signature_actions=[{'id': 'command', 'brief_refs': ['/core_verb'], 'action': 'Command a partner.',
                            'success_checks': ['partner moves'], 'boundary': {'checks': ['illegal order refused']},
                            'feedback': 'The partner animates its order.'}],
    )
    original = json.loads(json.dumps(card))
    prepare_behavior_card(card, json.loads(BRIEF.read_text(encoding='utf-8')))
    assert card['implementation']['controllers'] == original['implementation']['controllers']
    assert card['implementation']['camera'] == original['implementation']['camera']
    assert card['implementation']['input_model'] == original['implementation']['input_model']
    assert card['implementation']['catalog_skips'] == []
    assert card['input_checks'] == original['input_checks']
    assert card['signature_actions'] == original['signature_actions']
    assert not validate_meta(card)


def test_capability_checks_are_seeded_only_for_declared_capabilities():
    card = scene_card()
    card['capabilities'] = ['locomotion.walk']
    prepare_behavior_card(card, json.loads(BRIEF.read_text(encoding='utf-8')))
    assert card['capability_checks'] == {'locomotion.walk': []}
    # An empty check list is refused, so a declared capability cannot pass unproven.
    assert validate_meta(card)


def test_strategy_draft_names_the_required_outcomes_and_fails_until_authored():
    draft = starter_strategy()
    assert [scenario['expect'] for scenario in draft['scenarios']] == ['WON', 'LOST', 'WON']
    with pytest.raises(ValueError):
        validate_strategy(draft)
    authored = {**draft, 'interaction_events': ['partner-command'],
                'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}
    validate_strategy(authored)


def test_strategy_starter_rejects_unknown_scope():
    with pytest.raises(ValueError, match='unknown strategy scope'):
        starter_strategy('closur')


def test_strategy_starter_writes_a_new_file_and_never_overwrites(tmp_path):
    target = tmp_path / 'strategy.json'
    assert run(STEP3, '--starter', '--output', target).returncode == 0
    assert json.loads(target.read_text(encoding='utf-8')) == starter_strategy()
    target.write_text('authored by hand', encoding='utf-8')
    result = run(STEP3, '--starter', '--output', target)
    assert result.returncode == 2
    assert target.read_text(encoding='utf-8') == 'authored by hand'
    assert run(STEP3, '--starter').returncode == 0


@pytest.mark.parametrize('extra', [('--only', 'demo'), ('--record-attempt',), ('--project-root', '.')])
def test_strategy_starter_refuses_run_and_attempt_options(extra):
    result = run(STEP3, '--starter', *extra)
    assert result.returncode == 2
    assert '--starter' in result.stderr


def test_validate_only_reports_syntax_without_touching_the_project(tmp_path):
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps({**starter_strategy(), 'interaction_events': ['pick'],
                                    'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}))
    before = sorted(path.name for path in tmp_path.iterdir())
    result = run(STEP3, '--validate-only', '--strategy', strategy)
    assert result.returncode == 0, result.stderr
    assert 'strategy syntax OK' in result.stdout
    # No browser launch, evidence directory or attempt ledger belongs to a syntax check.
    assert sorted(path.name for path in tmp_path.iterdir()) == before


@pytest.mark.parametrize('plan,message', [
    ({'scenarios': []}, 'win, loss, replay'),
    ({'scenarios': [{'expect': 'WON', 'rules': []}] * 3, 'interaction_events': [],
      'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}, 'WON, LOST, WON'),
    ({**starter_strategy(), 'interaction_events': ['pick'], 'restart_actions': [{'type': 'tap', 'key': 'KeyR'}],
      'scenarios': [{'expect': 'WON', 'rules': [{'when': {'score': {'$above': 1}}}]},
                    {'expect': 'LOST', 'rules': []}, {'expect': 'WON', 'rules': []}]}, 'operator'),
])
def test_validate_only_fails_loudly_on_a_malformed_strategy(tmp_path, plan, message):
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps(plan))
    result = run(STEP3, '--validate-only', '--strategy', strategy)
    assert result.returncode == 1
    assert message in result.stderr
    assert 'Traceback' not in result.stderr


def test_validate_only_requires_a_strategy_and_refuses_evidence_options(tmp_path):
    assert run(STEP3, '--validate-only').returncode == 2
    strategy = tmp_path / 'strategy.json'
    strategy.write_text(json.dumps(starter_strategy()))
    assert run(STEP3, '--validate-only', '--strategy', strategy, '--output', 'evidence').returncode == 2
    assert not (Path.cwd() / 'evidence').exists()


def test_validate_only_missing_file_is_reported_not_traced(tmp_path):
    result = run(STEP3, '--validate-only', '--strategy', tmp_path / 'absent.json')
    assert result.returncode == 1
    assert 'error:' in result.stderr and 'Traceback' not in result.stderr


def write(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')
    return path


def test_condition_syntax_check_passes_without_a_snapshot(tmp_path):
    condition = write(tmp_path / 'condition.json', {'score': {'$gte': 3}, 'player.alive': True})
    result = run(CONDITION, condition)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {'syntax': 'valid'}


def test_condition_matching_separates_a_mismatch_from_a_malformed_predicate(tmp_path):
    condition = write(tmp_path / 'condition.json', {'score': {'$gte': 3}})
    snapshot = write(tmp_path / 'snapshot.json', {'score': 1})
    result = run(CONDITION, condition, '--snapshot', snapshot)
    assert result.returncode == 1
    assert json.loads(result.stdout) == {'syntax': 'valid', 'matches': False}
    write(snapshot, {'score': 5})
    result = run(CONDITION, condition, '--snapshot', snapshot)
    assert result.returncode == 0
    assert json.loads(result.stdout)['matches'] is True


def test_condition_reports_unknown_operators_and_unresolved_paths(tmp_path):
    bad_operator = write(tmp_path / 'operator.json', {'score': {'$above': 3}})
    assert run(CONDITION, bad_operator).returncode == 2
    assert 'operator' in run(CONDITION, bad_operator).stderr

    condition = write(tmp_path / 'condition.json', {'score': 1, 'player.alive': True})
    snapshot = write(tmp_path / 'snapshot.json', {'score': 2})
    result = run(CONDITION, condition, '--snapshot', snapshot)
    # A path that never resolves is an authoring error, not a scenario that simply did not match.
    assert result.returncode == 2
    assert 'missing observation: player.alive' in result.stderr

    assert run(CONDITION, tmp_path / 'absent.json').returncode == 2
    write(tmp_path / 'list.json', [{'score': 1}])
    assert run(CONDITION, tmp_path / 'list.json').returncode == 2


def passed_scene(root, monkeypatch):
    monkeypatch.setattr('scaffold.subprocess.run', lambda *a, **k: None)
    run_dir = initialize(root, 'scene', BRIEF)
    evidence = run_dir / 'evidence'
    evidence.mkdir()
    (evidence / 'report.json').write_text('{"functional": {"status": "passed"}}', encoding='utf-8')
    state = json.loads((root / '.state.json').read_text(encoding='utf-8'))
    state['current_stage'] = 'scene'
    state['stages']['intake']['status'] = 'passed'
    state['stages']['scene'].update(
        status='passed', evidence=['runs/step1/scene/evidence/report.json'],
        assessments=reviewed_assessments('runs/step1/scene/evidence/report.json'))
    (root / '.state.json').write_text(json.dumps(state), encoding='utf-8')
    return run_dir


def author_behavior(root, run_dir, strategy=None):
    """Bring a behavior run to a card the schema accepts, so acceptance can be planned."""
    card = json.loads((run_dir / 'step2.json').read_text(encoding='utf-8'))
    card['implementation'].update(camera='Fixed board camera.', input_model='Pointer selection.')
    card['input_checks'] = [{'name': 'choose a partner', 'actions': [{'type': 'click', 'x': 120, 'y': 80}],
                             'expect': {'selection': 'partner-1'}}]
    if strategy is not None:
        card['strategy'] = strategy
    (run_dir / 'step2.json').write_text(json.dumps(card), encoding='utf-8')
    state = json.loads((root / '.state.json').read_text(encoding='utf-8'))
    artifact = run_dir.relative_to(root).as_posix()
    state['current_stage'] = 'behavior'
    state['stages']['behavior'].update(
        status='passed', artifact=artifact, evidence=[f'{artifact}/evidence/report.json'],
        assessments=reviewed_assessments(f'{artifact}/evidence/report.json'))
    evidence = run_dir / 'evidence'
    evidence.mkdir(exist_ok=True)
    (evidence / 'report.json').write_text('{"functional": {"status": "passed"}}', encoding='utf-8')
    (root / '.state.json').write_text(json.dumps(state), encoding='utf-8')


def test_advance_into_acceptance_seeds_a_strategy_draft(tmp_path, monkeypatch):
    scene = passed_scene(tmp_path, monkeypatch)
    behavior = advance(tmp_path, 'behavior', 'scene')
    assert not (scene / 'strategy.json').exists()
    author_behavior(tmp_path, behavior)
    acceptance = advance(tmp_path, 'acceptance', 'behavior')
    assert json.loads((acceptance / 'strategy.json').read_text(encoding='utf-8')) == starter_strategy()


def test_advance_preserves_a_copied_strategy_instead_of_replacing_it(tmp_path, monkeypatch):
    passed_scene(tmp_path, monkeypatch)
    behavior = advance(tmp_path, 'behavior', 'scene')
    authored = {**starter_strategy(), 'interaction_events': ['partner-command'],
                'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}
    (behavior / 'strategy.json').write_text(json.dumps(authored), encoding='utf-8')
    author_behavior(tmp_path, behavior)
    acceptance = advance(tmp_path, 'acceptance', 'behavior')
    assert json.loads((acceptance / 'strategy.json').read_text(encoding='utf-8')) == authored


def test_advance_keeps_a_run_relative_strategy_selection(tmp_path, monkeypatch):
    """A card that selects its own path keeps it, and the copy travels with the run."""
    passed_scene(tmp_path, monkeypatch)
    behavior = advance(tmp_path, 'behavior', 'scene')
    authored = {**starter_strategy(), 'interaction_events': ['partner-command'],
                'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}
    selected = behavior / 'strategies/play-through.json'
    selected.parent.mkdir()
    selected.write_text(json.dumps(authored), encoding='utf-8')
    author_behavior(tmp_path, behavior, strategy='strategies/play-through.json')
    acceptance = advance(tmp_path, 'acceptance', 'behavior')
    card = json.loads((acceptance / 'step3.json').read_text(encoding='utf-8'))
    assert card['strategy'] == 'strategies/play-through.json'
    assert json.loads((acceptance / card['strategy']).read_text(encoding='utf-8')) == authored
    assert not (acceptance / 'strategy.json').exists(), 'a selected strategy must not gain a rival draft'


def test_advance_prefers_a_project_strategy_over_a_new_draft(tmp_path, monkeypatch):
    passed_scene(tmp_path, monkeypatch)
    behavior = advance(tmp_path, 'behavior', 'scene')
    authored = {**starter_strategy(), 'interaction_events': ['partner-command'],
                'restart_actions': [{'type': 'tap', 'key': 'KeyR'}]}
    (tmp_path / 'strategy.json').write_text(json.dumps(authored), encoding='utf-8')
    author_behavior(tmp_path, behavior)
    acceptance = advance(tmp_path, 'acceptance', 'behavior')
    assert not (acceptance / 'strategy.json').exists()
    assert json.loads((tmp_path / 'strategy.json').read_text(encoding='utf-8')) == authored
