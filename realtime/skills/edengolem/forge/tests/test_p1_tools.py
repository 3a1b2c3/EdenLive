"""P1 evidence reuse, failure diagnosis and bounded tool behavior."""
import builtins
import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

import check_step1
import check_rounds
import check_step3
import recovery
from _shared import attempts, diagnostics, image_review
from _shared.constants import GATE_TIMEOUT_SECONDS, MAX_WALL_SECONDS
from gate_fixtures import MENU_GAME, MENU_STRATEGY, write_game

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def project(tmp_path):
    root = tmp_path / 'game with spaces'
    run = write_game(root / 'runs/step3/menu', MENU_GAME)
    (root / 'shared.js').write_text('export const version = 1;')
    (run / 'strategy.json').write_text(json.dumps(MENU_STRATEGY))
    return root, run


def record(root, run, status='passed'):
    return attempts.record_stage(root, run, 'step3:menu', root / 'evidence/play/report.json',
                                 {'functional': {'status': status}}, attempts.stage_snapshot(root, run))


@pytest.mark.parametrize('mutation', ['source', 'brief', 'shared', 'lockfile', 'add', 'delete', 'report'])
def test_evidence_invalidates_on_actual_inputs_and_report(project, mutation):
    root, run = project
    (root / 'package-lock.json').write_text('{}')
    entry = record(root, run)
    assert attempts.evidence_valid(root, entry)
    files = {'source': run / 'main.js', 'brief': run / 'brief.json', 'shared': root / 'shared.js',
             'lockfile': root / 'package-lock.json', 'add': run / 'new.js',
             'report': root / 'evidence/play/report.json'}
    if mutation == 'delete':
        (run / 'main.js').unlink()
    else:
        files[mutation].write_text('changed')
    assert not attempts.evidence_valid(root, entry)
    assert attempts.reusable(root, 'step3:menu') is None
    assert attempts.load_ledger(root)['attempts'] == [entry]


def test_evidence_ignores_output_and_other_runs_but_preserves_failure_history(project):
    root, run = project
    entry = record(root, run, 'failed')
    write_game(root / 'runs/step1/another', {'main.js': 'unrelated'})
    write_game(run / 'evidence', {'image.png': 'output'})
    (root / '.state.json').write_text('{}')
    (root / 'server.log').write_text('output')
    assert attempts.reusable(root, 'step3:menu')['result'] == 'failed'
    assert attempts.evidence_valid(root, entry)
    (run / 'main.js').write_text('fixed source')
    passed = record(root, run)
    assert attempts.reusable(root, 'step3:menu') == passed
    assert [row['result'] for row in attempts.load_ledger(root)['attempts']] == ['failed', 'passed']


def test_recovery_rechecks_current_hashes(project):
    root, run = project
    record(root, run)
    recovery.write_recovery(root, artifact='runs/step3/menu', check='step3:menu',
                            next_step='inspect feedback', unresolved=['image review'])
    note = recovery.read_recovery(root)
    assert note['artifact_current'] and note['latest']['valid']
    assert note['reusable']['result'] == 'passed'
    (run / 'main.js').write_text('new source')
    note = recovery.read_recovery(root)
    assert not note['artifact_current'] and not note['latest']['valid']
    assert note['reusable'] is None and note['unresolved'] == ['image review']


def test_ledger_rejects_unknown_formats_and_invalid_records(project):
    root, run = project
    path = attempts.ledger_path(root)
    path.parent.mkdir()
    path.write_text('{"format":"old","attempts":[]}')
    with pytest.raises(ValueError, match='format'):
        attempts.load_ledger(root)
    path.unlink()
    with pytest.raises(ValueError, match='invalid attempt ledger'):
        attempts.record_attempt(root, check='core', artifact=[run], result='passed', run_id=42)
    assert not path.exists()


def test_diagnostics_are_capability_and_field_specific():
    for caps in ([], ['discrete_state'], ['timing', 'resources'], ['custom:dialogue']):
        assert diagnostics.diagnose({'diagnostics': {'contact': True}}, caps)['status'] == 'not_applicable'
    for value in (None, {}, {'unrelated': 1}):
        assert diagnostics.diagnose({'diagnostics': value}, ['navigation'])['status'] == 'not_evaluated'
    fields = {'activation': True, 'targetFilter': 'eligible',
              'reachableTargets': {'status': 'not_applicable', 'reason': 'fixed encounter'}}
    result = diagnostics.diagnose({'diagnostics': fields}, ['discrete_state', 'autonomous_agents'])
    assert result['status'] == 'observed'
    assert result['reachableTargets'] == fields['reachableTargets']
    assert 'attackWindow' not in result and 'displacement' not in result


def test_image_capture_has_a_bounded_failure_budget_and_no_review_pass(monkeypatch):
    calls = []
    class Page:
        def screenshot(self, **kwargs):
            calls.append(kwargs)
            raise TimeoutError('channel failed')
    monkeypatch.setattr(image_review.time, 'sleep', lambda _: None)
    result = image_review.preflight(Page())
    assert len(calls) == 3 and all(call['timeout'] == 5000 for call in calls)
    assert result['status'] == result['review'] == 'not_evaluated'
    with pytest.raises(ValueError):
        image_review.preflight(Page(), retries=3)
    class PNG:
        def screenshot(self, **kwargs):
            return b'\x89PNG\r\n\x1a\n' + b'0' * 24
    result = image_review.preflight(PNG())
    assert result['status'] == 'channel_ready' and result['attempts'] == 1
    assert result['review'] == 'not_evaluated'


@pytest.mark.parametrize('failure', ['budget', 'driver', 'node'])
def test_rules_failures_are_recorded(project, monkeypatch, failure):
    root, run = project
    if failure == 'budget':
        (run / 'brief.json').write_text('{}')
    elif failure == 'driver':
        monkeypatch.setattr(check_rounds, 'drive', lambda *a: (None, 'invalid Node output'))
    else:
        monkeypatch.setattr(check_rounds.shutil, 'which', lambda _: None)
    assert check_rounds.main(['--project-root', str(root), str(run), '--record-attempt']) != 0
    entry = attempts.reusable(root, 'rounds:menu')
    assert entry['result'] == ('not_evaluated' if failure == 'node' else 'failed')
    assert entry['failure']


@pytest.mark.parametrize('failure', ['playwright', 'chromium', 'launch'])
def test_core_environment_failures_are_recorded(project, monkeypatch, failure):
    root, _ = project
    original = builtins.__import__
    if failure == 'playwright':
        def no_playwright(name, *args, **kwargs):
            if name == 'playwright.sync_api':
                raise ImportError('missing test dependency')
            return original(name, *args, **kwargs)
        monkeypatch.setattr(builtins, '__import__', no_playwright)
    else:
        pytest.importorskip('playwright.sync_api')
        monkeypatch.setattr(check_step1, 'find_chromium', lambda: None if failure == 'chromium' else sys.executable)
        if failure == 'launch':
            def broken_service(*args):
                raise OSError('test launch failed')
            monkeypatch.setattr(check_step1, 'serving', broken_service)
    assert check_step1.main(['--project-root', str(root), '--runs', 'runs/step3', '--record-attempt']) != 0
    entry = attempts.reusable(root, 'step1:menu')
    assert entry['result'] == 'not_evaluated' and entry['failure']


@pytest.mark.parametrize('wall,expected', [(0, 2), (-1, 2), (MAX_WALL_SECONDS + 1, 2), (600, 2)])
def test_wall_budget_stays_inside_one_gate_timeout(project, wall, expected):
    """Three scenarios plus a capture replay must fit finish.py's gate subprocess bound."""
    root, _ = project
    assert 3 * MAX_WALL_SECONDS + 15 < GATE_TIMEOUT_SECONDS
    assert check_step3.main(['--project-root', str(root), '--only', 'menu',
                            '--strategy', 'runs/step3/menu/strategy.json', '--output', 'evidence/play',
                            '--wall-seconds', str(wall)]) == expected
    # Rejected configuration is not a recorded gameplay attempt.
    assert attempts.reusable(root, 'step3:menu') is None


@pytest.mark.parametrize('failure', ['brief', 'metadata', 'strategy'])
def test_playthrough_configuration_failure_is_preserved(project, failure):
    root, run = project
    file = {'brief': 'brief.json', 'metadata': 'step3.json', 'strategy': 'strategy.json'}[failure]
    (run / file).write_text('{')
    assert check_step3.main(['--project-root', str(root), '--only', 'menu',
                            '--strategy', 'runs/step3/menu/strategy.json', '--output', 'evidence/play',
                            '--record-attempt']) == 1
    entry = attempts.reusable(root, 'step3:menu')
    assert entry['result'] == 'failed' and entry['failure']


def manifest(*args):
    return subprocess.run([sys.executable, str(ROOT / 'forge/factory_manifest.py'), *args],
                          capture_output=True, text=True, timeout=20)


def test_manifest_links_and_single_factory_options_use_real_exports():
    output = manifest()
    assert output.returncode == 0, output.stderr
    data = json.loads(output.stdout)
    Draft7Validator(json.loads((ROOT / 'docs/specs/factory-manifest.schema.json').read_text())).validate(data)
    for factory in data['factories']:
        assert factory['status'] == 'ready'
        assert (ROOT / factory['apiDoc']).is_file()
        assert 'params' not in factory  # The index does not load every schema into context.
    single = json.loads(manifest('--factory', 'CharacterVisualFactory').stdout)['factories'][0]
    assert single['params'] and single['presets'] and single['runtimeDependencies']
    assert single['constructor'] == 'createCharacterVisual'
    options = '{"height":2.1,"loadout":{"left":null,"right":{"preset":"bow","drawAmount":0.7}}}'
    normalized = manifest('--factory', 'CharacterVisualFactory', '--options', options)
    assert normalized.returncode == 0, normalized.stderr
    direct = subprocess.run(['node', '--input-type=module', '-e',
                             "import {normalizeCharacterOptions as n} from './assets/world/object/factory/CharacterVisualFactory.js'; console.log(JSON.stringify(n(JSON.parse(process.argv[1]))));", options],
                            cwd=ROOT, capture_output=True, text=True, check=True)
    assert json.loads(normalized.stdout)['options'] == json.loads(direct.stdout)


@pytest.mark.parametrize('factory,options', [
    ('Equipment', {'preset': 'bow', 'drawAmount': 0.3}),
    ('FantasyCreature', {'preset': 'wyvern', 'motionAmount': 0.5}),
    ('Pickup', {'preset': 'gem', 'count': 3, 'layout': 'cluster'}),
    ('Mechanism', {'preset': 'gate', 'switchDuration': 0.8}),
])
def test_extended_factory_queries_resolve_public_entrypoints_and_options(factory, options):
    query = manifest('--factory', factory)
    assert query.returncode == 0, query.stderr
    entry = json.loads(query.stdout)['factories'][0]
    assert entry['constructor'] == f'create{factory}Visual'
    assert options['preset'] in entry['presets']
    assert entry['params'] and entry['runtimeDependencies']
    resolved = manifest('--factory', factory, '--options', json.dumps(options))
    assert resolved.returncode == 0, resolved.stderr
    assert json.loads(resolved.stdout)['options'].items() >= options.items()


@pytest.mark.parametrize('args', [
    ['--factory', 'Character', '--options', '{"invented":1}'],
    ['--factory', 'Character', '--options', '{"colors":{"invented":1}}'],
    ['--factory', 'Character', '--options', '{"loadout":{"right":{"preset":"bow","invented":1}}}'],
    ['--factory', 'Character', '--options', '{"loadout":{"middle":null}}'],
    ['--factory', 'Character', '--options', '[]'],
    ['--factory', 'Grass', '--options', '{}'],
    ['--factory', 'VisualFactory'], ['--factory', 'Unknown'],
])
def test_manifest_rejects_guessing_and_ambiguous_queries(args):
    output = manifest(*args)
    assert output.returncode != 0 and 'error:' in output.stderr
