"""Behavioral coverage for capability-neutral input, budgets and artifact provenance."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'forge'))

from _shared.browser_input import act, matches, release_inputs, resolves, validate_action
from _shared.run_contract import validation_budget
from _shared.state import stage_artifact, state_errors
from check_step3 import validate_strategy, verdict
from gate_fixtures import HELD_INPUT_STRATEGY
from test_state import progressed_state
from test_validate import minimal_brief
from test_validate_run_meta import VALID
from validate_game_brief import validate_brief
from validate_run_meta import validate_meta


def test_semantic_tags_and_custom_controls_do_not_require_colors_or_collisions():
    brief = minimal_brief()
    brief.update(control_scheme='custom', player_modality='menu', interaction_tags=[])
    assert not validate_brief(brief)
    brief['interaction_tags'] = [{'id': 'command', 'role': 'action', 'meaning': 'Commit a command.'}]
    assert not validate_brief(brief)
    brief['interaction_tags'].append({'id': 'command', 'role': 'information', 'meaning': 'Conflicting ID.'})
    assert any('unique' in error.message for error in validate_brief(brief))
    brief['interaction_tags'] = [{'id': 'command', 'meaning': 'Missing semantic role.'}]
    assert validate_brief(brief)


def test_hybrid_run_card_and_structured_checks_validate_without_control_inference():
    card = dict(VALID, control_scheme='custom', player_modality='menu',
                controls=['Choose a route, then confirm a command'],
                capabilities=['discrete_state', 'mixed_modes', 'custom:route_choice'],
                implementation={'controllers': [], 'camera': 'fixed board', 'input_model': 'edge-triggered choices'},
                input_checks=[{'name': 'confirm', 'actions': [{'type': 'tap', 'key': 'Enter'}], 'expect': {'mode': 'encounter'}}])
    assert not validate_meta(card)
    assert validate_meta(dict(card, input_checks=[]))


def test_budget_uses_newest_card_and_validated_brief(tmp_path):
    brief = minimal_brief()
    brief['time_budget_seconds'] = 240
    (tmp_path / 'brief.json').write_text(json.dumps(brief))
    (tmp_path / 'step1.json').write_text('{}')
    (tmp_path / 'step3.json').write_text('{"brief":"brief.json"}')
    seconds, source = validation_budget(tmp_path)
    assert seconds == 240 and source == str(tmp_path / 'brief.json')
    assert validation_budget(tmp_path, 300) == (300, 'explicit CLI override')
    del brief['win_state']
    (tmp_path / 'brief.json').write_text(json.dumps(brief))
    with pytest.raises(ValueError, match='win_state'):
        validation_budget(tmp_path)
    (tmp_path / 'step3.json').unlink()
    with pytest.raises(ValueError, match='must link a brief'):
        validation_budget(tmp_path)


@pytest.mark.parametrize('value', [True, False, 0, -1, 301, float('nan'), float('inf'), '240'])
def test_invalid_budget_never_silently_falls_back(tmp_path, value):
    with pytest.raises(ValueError):
        validation_budget(tmp_path, value)


@pytest.mark.parametrize('value', [None, True, 240, [], {}, '', ' '])
def test_invalid_brief_path_fails_with_a_contract_error(tmp_path, value):
    (tmp_path / 'step3.json').write_text(json.dumps({'brief': value}))
    with pytest.raises(ValueError, match='brief must be a nonempty path string'):
        validation_budget(tmp_path)


def test_completed_stages_require_explicit_artifacts_and_never_inherit(tmp_path):
    state = progressed_state('acceptance')
    state['stages']['scene'].update(status='passed', evidence=['core report'], artifact='runs/scene')
    state['stages']['behavior'].update(status='passed', evidence=['loop report'], artifact='runs/behavior')
    path = tmp_path / '.state.json'
    assert not state_errors(state)
    assert stage_artifact(state, 'behavior', path) == tmp_path / 'runs/behavior'
    # The chosen artifact stays explicit even when a predecessor is malformed.
    del state['stages']['scene']['artifact']
    assert any('artifact' in error for error in state_errors(state))
    assert stage_artifact(state, 'behavior', path) == tmp_path / 'runs/behavior'
    state['stages']['behavior']['artifact'] = 'runs/behavior'
    del state['stages']['behavior']['artifact']
    assert any('artifact' in error for error in state_errors(state))
    state['stages']['behavior']['artifact'] = str(tmp_path / 'current')
    assert stage_artifact(state, 'behavior', path) == tmp_path / 'current'
    state['stages']['behavior']['artifact'] = ''
    assert state_errors(state)


def test_exact_observations_distinguish_booleans_from_numbers_recursively():
    assert matches({'x': {'items': [1, True]}}, {'x': {'items': [1.0, True]}})
    assert not matches({'x': {'items': [1, True]}}, {'x': {'items': [True, 1]}})
    for path in ('', 'x..items', '.x', 'x.'):
        with pytest.raises(ValueError):
            matches({'x': 1}, {path: 1})


def test_asserted_conditions_require_fields_but_rules_tolerate_an_inactive_mode():
    """A mode that omits another mode's fields leaves its rules unmatched, not fatal."""
    travel = {'mode': 'travel', 'car': {'speed': 12}}
    for condition in ({'battle.target': 'wolf'}, {'battle.target': {'$ne': 'wolf'}},
                      {'battle.hp': {'$lt': 3}}, {'car.speed': {'$lt': 20}, 'battle.hp': {'$gt': 0}}):
        with pytest.raises(ValueError, match='missing observation|finite observed number'):
            matches(travel, condition)
        assert not matches(travel, condition, strict=False)
    # A resolvable rule still decides on its real value in either mode.
    assert matches(travel, {'car.speed': {'$lt': 20}}, strict=False)
    assert not matches(travel, {'car.speed': {'$gt': 20}}, strict=False)
    # Malformed syntax remains an authoring error, never a silently skipped rule.
    for condition in ({'': 1}, {'car.speed': {'$gt': 'fast'}}, {'car.speed': {'$unknown': 1}}):
        with pytest.raises(ValueError):
            matches(travel, condition, strict=False)


def test_unreadable_paths_are_reported_without_raising():
    snapshot = {'mode': 'travel', 'car': {'speed': 12}}
    assert resolves(snapshot, 'car.speed') and resolves(snapshot, 'mode')
    assert not resolves(snapshot, 'battle.target') and not resolves(snapshot, 'car.speed.value')


@pytest.mark.parametrize('action', [
    {'type': 'tap', 'key': ''}, {'type': 'click', 'x': True, 'y': 0},
    {'type': 'move', 'x': float('nan'), 'y': 1}, {'type': 'evaluate', 'code': 'win()'},
    {'type': 'tap', 'key': 'Enter', 'state': 'WON'}, {'type': 'pointer_down', 'button': 'back'},
])
def test_malformed_or_state_mutating_inputs_fail(action):
    with pytest.raises(ValueError):
        validate_action(action)


def test_held_keys_from_any_action_sequence_are_released():
    class Device:
        def __init__(self): self.released = []
        def down(self, key): pass
        def up(self, key=None, button=None): self.released.append(key or button)
    class Page:
        keyboard = Device()
        mouse = Device()
    page, held = Page(), set()
    act(page, {'type': 'down', 'key': 'Space'}, held)
    release_inputs(page, held)
    assert not held and page.keyboard.released == ['Space']
    assert page.mouse.released == ['left', 'middle', 'right']


@pytest.mark.parametrize('mutation', [
    {'interaction_events': 'move.committed'}, {'start_actions': {}},
    {'capture_when': {'state..invalid': True}},
])
def test_strategy_rejects_ambiguous_shapes(mutation):
    with pytest.raises(ValueError):
        validate_strategy(dict(HELD_INPUT_STRATEGY, **mutation))


def test_zero_time_discrete_result_is_valid_but_boolean_metrics_are_not():
    state = {'state': 'WON', 'elapsed': 0, 'terminalCount': 1}
    assert verdict(state, 'WON', [{}], [{}], 120) is None
    for key in ('elapsed', 'terminalCount'):
        assert verdict(dict(state, **{key: True}), 'WON', [{}], [{}], 120)
