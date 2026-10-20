"""Behavioral coverage for startup, signature acceptance and input scheduling."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from _shared.browser_input import matches, validate_condition
from _shared.signature import signature_evidence_problems, signature_problems
from _shared.state import state_errors
from check_step3 import apply_rules, note_unresolved, validate_strategy
from scaffold import ROOT, advance, asset_closure, copy_assets, initialize, write_new
from validate_run_meta import validate_meta
from test_state import reviewed_assessments


def test_every_brief_initializes_without_genre_defaults(tmp_path, monkeypatch):
    # npm itself is exercised in the independent packaging smoke, not 24 network calls.
    monkeypatch.setattr('scaffold.subprocess.run', lambda *a, **k: None)
    briefs = sorted((ROOT / 'assets/game-briefs').glob('*.json'))
    assert len(briefs) == 24
    for brief in briefs:
        root = tmp_path / brief.stem
        run = initialize(root, 'scene', brief)
        card = json.loads((run / 'step1.json').read_text())
        assert not validate_meta(card)
        assert not state_errors(json.loads((root / '.state.json').read_text()))
        state = json.loads((root / '.state.json').read_text())
        assert state['stages']['intake']['status'] == 'in_progress'
        assert state['stages']['scene']['status'] == 'not_started'
        assert signature_problems(card)  # A skeleton cannot earn a core pass.
        assert card['controls'] == []
        assert card['core_verb'] == json.loads(brief.read_text())['core_verb']
        assert len(list((root / 'runs').glob('step*'))) == 3
        assert not list((root / 'assets').rglob('*Factory*'))
        # Capabilities route implementation and checks, so init must never guess one.
        assert card['capabilities'] == []
        # The optional loop helper ships with every run; a mode is chosen when behavior lands.
        assert (run / 'game-loop.mjs').is_file()
        # Every theme element the brief names gets a manifest row to bind, unbound at scene start.
        manifest = json.loads((run / 'scene-manifest.json').read_text())
        elements = json.loads(brief.read_text())['scene']['theme_elements']
        assert [row['id'] for row in manifest['elements']] == [e['id'] for e in elements]
        assert all(not row['binding'] and not row['asset'] for row in manifest['elements'])


def test_asset_closure_preserves_paths_data_workers_and_refuses_ambiguity(tmp_path):
    source = tmp_path / 'source'
    a = source / 'assets/lib'; a.mkdir(parents=True)
    (a / 'main.js').write_text("import './dep.js'; export {x} from './more.js'; fetch('./data.json'); new Worker(new URL('./worker.js', import.meta.url));")
    (a / 'dep.js').write_text("import 'three';")
    (a / 'more.js').write_text('export const x=1;')
    (a / 'data.json').write_text('{}')
    (a / 'worker.js').write_text("import './dep.js';")
    (source / 'NOTICE').write_text('keep attribution')
    files, packages, unresolved = asset_closure(['assets/lib/main.js'], source=source)
    assert len(files) == 6 and packages == {'three'} and not unresolved
    (a / 'main.js').write_text('const p="./data.json"; fetch(p);')
    with pytest.raises(ValueError, match='dynamic-note'):
        asset_closure(['assets/lib/main.js'], source=source)
    files, _, unresolved = asset_closure(['assets/lib/main.js'], ['assets/lib/data.json'], source, 'p resolves to data.json')
    assert unresolved and 'assets/lib/data.json' in files
    project = tmp_path / 'project'; project.mkdir()
    (project / 'package.json').write_text('{"dependencies":{"three":"0.161.0"}}')
    copy_assets(project, ['assets/lib/main.js'], ['assets/lib/data.json'], source, 'p resolves to data.json')
    (a / 'data.json').write_text('{"version":2}')
    with pytest.raises(ValueError, match='conflicting'):
        copy_assets(project, ['assets/lib/data.json'], source=source)
    assert (project / 'assets/lib/data.json').read_text() == '{}'


def test_conflicts_fail_before_writes_and_merge_preserves_package_settings(tmp_path, monkeypatch):
    brief = ROOT / 'assets/game-briefs/creature-battle.brief.json'
    root = tmp_path / 'game'; root.mkdir()
    (root / 'package.json').write_text('{"scripts":{"test":"keep"},"description":"keep"}')
    (root / 'launch.sh').write_text('existing launcher')
    monkeypatch.setattr('scaffold.subprocess.run', lambda *a, **k: None)
    with pytest.raises(ValueError, match='conflicting'):
        initialize(root, 'scene', brief)
    assert not (root / '.state.json').exists()
    assert 'dependencies' not in json.loads((root / 'package.json').read_text())
    (root / 'launch.sh').unlink()
    initialize(root, 'scene', brief)
    assert json.loads((root / 'package.json').read_text())['scripts']['test'] == 'keep'
    outside = tmp_path / 'outside'; outside.mkdir()
    (root / 'external').symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError): write_new(root, {'ok.txt': b'ok', 'external/no.txt': b'no'})
    assert not (root / 'ok.txt').exists()


def test_advance_requires_pass_and_keeps_old_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr('scaffold.subprocess.run', lambda *a, **k: None)
    run = initialize(tmp_path, 'scene', ROOT / 'assets/game-briefs/creature-battle.brief.json')
    with pytest.raises(ValueError, match='passed'): advance(tmp_path, 'behavior', 'scene')
    evidence = run / 'evidence'; evidence.mkdir(); (evidence / 'report.json').write_text('{"passed":true}')
    state = json.loads((tmp_path / '.state.json').read_text())
    state['stages']['intake'].update(status='passed')
    state['current_stage'] = 'scene'
    state['stages']['scene'].update(status='passed', evidence=['runs/step1/scene/evidence/report.json'],
                                 assessments=reviewed_assessments('runs/step1/scene/evidence/report.json'))
    (tmp_path / '.state.json').write_text(json.dumps(state))
    next_run = advance(tmp_path, 'behavior', 'scene')
    assert not (next_run / 'evidence').exists()
    assert (evidence / 'report.json').is_file()
    assert (next_run / 'main.js').read_bytes() == (run / 'main.js').read_bytes()
    assert json.loads((tmp_path / '.state.json').read_text())['stages']['behavior']['evidence'] == []
    with pytest.raises(ValueError): advance(tmp_path, 'behavior', 'scene')


def signature_card():
    return {'input_checks': [{'name': 'legal move', 'expect': {'board.committed': 1}}, {'name': 'occupied', 'expect': {'board.committed': 1}}],
            'signature_actions': [{'id': 'place', 'brief_refs': ['/core_verb'], 'action': 'Place a piece', 'feedback': 'Piece remains on the selected cell',
                                   'success_checks': ['legal move'], 'boundary': {'checks': ['occupied']}}]}


def test_acceptance_requires_defining_success_and_explicit_boundary_or_skip():
    assert signature_problems({})
    assert signature_problems({'signature_actions': []})
    card = signature_card()
    assert not signature_problems(card, {'core_verb': 'Place'})
    card['input_checks'][0]['expect'] = {'score': 1, 'state': 'WON'}
    assert signature_problems(card)
    card = signature_card(); card['signature_actions'][0]['boundary'] = {}
    assert signature_problems(card)
    card['signature_actions'][0]['boundary'] = {'skip_reason': 'No rejected choice exists; success check also observes single commit persistence.'}
    assert not signature_problems(card)
    assert signature_problems(card, {})


def test_signature_changes_must_survive_the_wait_and_belong_to_success_cases():
    card = signature_card()
    observation = {'name': 'legal move', 'phase': 'settle_ms',
                   'before': {'board': {'committed': 0}}, 'after': {'board': {'committed': 1}},
                   'expect': {'board.committed': {'$gte': 0}}}
    reverted = dict(observation, phase='persist_ms', after={'board': {'committed': 0}})
    boundary = dict(observation, name='occupied', phase='persist_ms')
    assert signature_evidence_problems(card, [observation, reverted, boundary])
    persisted = dict(observation, phase='persist_ms')
    assert not signature_evidence_problems(card, [observation, persisted])
    # A repeated success and rejection may leave state unchanged once placement is proven.
    card['signature_actions'][0]['success_checks'].append('repeat')
    unchanged = dict(persisted, before=persisted['after'])
    assert not signature_evidence_problems(card, [persisted, dict(unchanged, name='repeat'),
                                               dict(unchanged, name='occupied')])


@pytest.mark.parametrize('field,before,after', [
    ('score', 0, 1), ('elapsed', 0, 1), ('state', 'RUNNING', 'WON'),
    ('roundId', 0, 1), ('terminalCount', 0, 1), ('frame.id', 0, 1),
])
def test_generic_changes_do_not_prove_a_signature_action(field, before, after):
    def snapshot(value):
        data = {'board': {'committed': 1}}
        if field == 'frame.id': data['frame'] = {'id': value}
        else: data[field] = value
        return data
    observation = {'name': 'legal move', 'phase': 'persist_ms', 'before': snapshot(before),
                   'after': snapshot(after), 'expect': {'board.committed': {'$gte': 1}, field: after}}
    assert signature_evidence_problems(signature_card(), [observation])


class InputPage:
    def __init__(self):
        self.actions = []
        self.state = {'state': 'RUNNING', 'elapsed': 0, 'selection': 0}
        def down(key):
            self.actions.append(('down', key))
            if key == 'ArrowDown': self.state['selection'] = 1
        self.keyboard = SimpleNamespace(down=down, up=lambda key: self.actions.append(('up', key)))
    def wait_for_timeout(self, _ms): pass


def test_snapshot_dispatch_reads_no_additional_state_and_only_changes_held_keys():
    page = InputPage(); held = set(); trace = []
    rules = {'rules': [{'when': {'selection': {'$lt': 1}}, 'hold': ['ArrowRight']} ]}
    for _ in range(50):
        apply_rules(page, page.state.copy(), rules, {}, set(), held, trace)
    assert page.actions == [('down', 'ArrowRight')]
    page.state['selection'] = 1
    apply_rules(page, page.state, rules, {}, set(), held, trace)
    assert page.actions[-1] == ('up', 'ArrowRight') and not held


def test_dependent_actions_wait_for_the_next_observation():
    rules = {'rules': [
        {'when': {'selection': 0}, 'action': {'type': 'tap', 'key': 'ArrowDown'}},
        {'when': {'selection': 1}, 'action': {'type': 'tap', 'key': 'Enter'}},
    ]}
    page = InputPage()
    apply_rules(page, page.state.copy(), rules, {}, set(), set(), [])
    assert page.actions == [('down', 'ArrowDown'), ('up', 'ArrowDown')]
    apply_rules(page, page.state.copy(), rules, {}, set(), set(), [])
    assert page.actions[-2:] == [('down', 'Enter'), ('up', 'Enter')]


def test_playthrough_rules_skip_fields_the_active_mode_does_not_expose():
    """A travel-only observation must not abort a round that also names a battle field."""
    page = InputPage()
    page.state = {'state': 'RUNNING', 'elapsed': 0, 'mode': 'travel', 'car': {'speed': 12}}
    rules = {'rules': [
        {'when': {'car.speed': {'$lt': 20}}, 'hold': ['ArrowUp']},
        {'when': {'battle.target': 'wolf'}, 'action': {'type': 'tap', 'key': 'Enter'}, 'once': True},
        {'when': {'battle.hp': {'$lt': 3}}, 'hold': ['Space']},
    ]}
    apply_rules(page, page.state, rules, {}, set(), set(), [])
    assert page.actions == [('down', 'ArrowUp')]
    page.state['car']['speed'] = 25
    apply_rules(page, page.state, rules, {}, set(), {'ArrowUp'}, [])
    assert page.actions[-1] == ('up', 'ArrowUp')
    # A mistyped path is still an authoring error, not a skipped rule.
    with pytest.raises(ValueError):
        apply_rules(page, page.state, {'rules': [{'when': {'': 1}, 'action': {'type': 'tap', 'key': 'x'}}]},
                    {}, set(), set(), [])
    record = {}
    resolved = set()
    note_unresolved(record, page.state, rules['rules'], resolved)
    assert resolved == {0}
    assert record['unresolvedRules'] == [
        {'rule': 1, 'when': ['battle.target']},
        {'rule': 2, 'when': ['battle.hp']},
    ]
    note_unresolved(record, {'mode': 'battle', 'battle': {'target': 'wolf', 'hp': 2}}, rules['rules'], resolved)
    assert resolved == {0, 1, 2} and record['unresolvedRules'] == []


def test_predicates_are_strict_and_strategy_cannot_mix_held_edges():
    assert matches({'x': {'$gt': 3}}, {'x': {'$eq': {'$gt': 3}}})
    assert matches({'x': 4}, {'x': {'$gt': 3, '$lte': 4}})
    assert not matches({'x': 2}, {'x': {'$gt': 3}})
    with pytest.raises(ValueError): matches({'x': True}, {'x': {'$gt': 0}})
    with pytest.raises(ValueError): validate_condition({'x': {'$eval': 'anything'}})
    from gate_fixtures import MENU_STRATEGY
    plan = copy.deepcopy(MENU_STRATEGY)
    validate_strategy(plan)
    plan['scenarios'][0]['rules'][0]['action'] = {'type': 'down', 'key': 'a'}
    with pytest.raises(ValueError): validate_strategy(plan)
