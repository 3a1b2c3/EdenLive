"""Exercise owned service lifetimes and a real relocated game with input."""
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

import check_step1
import check_step3
import run_project
from _shared import attempts
from gate_fixtures import MENU_GAME, MENU_STRATEGY, write_game
from test_standalone_project import project  # shared isolated fixture with spaces

ROOT = Path(__file__).resolve().parents[2]


def test_server_checks_owned_pid_and_never_kills_the_port_owner(project, tmp_path):
    log = tmp_path / 'server.log'
    with run_project.project_server(project, log=log) as first:
        assert first['process'].poll() is None
        with pytest.raises((RuntimeError, TimeoutError)):
            with run_project.project_server(project, port=first['port'], timeout=1):
                pytest.fail('accepted another process as its server')
        assert first['process'].poll() is None
    assert first['process'].poll() is not None and log.stat().st_size > 0


def test_readiness_timeout_cleans_the_started_process(project, monkeypatch):
    (project / 'launch.sh').write_text('#!/bin/sh\nexec python3 -c "import time; time.sleep(60)"\n')
    started, popen = [], subprocess.Popen
    def track(*args, **kwargs):
        process = popen(*args, **kwargs)
        started.append(process)
        return process
    monkeypatch.setattr(run_project.subprocess, 'Popen', track)
    with pytest.raises(TimeoutError):
        with run_project.project_server(project, timeout=.15):
            pytest.fail('a process that never serves was marked ready')
    assert started and started[0].poll() is not None


def test_background_sigterm_cleans_service_and_owned_pid(project, tmp_path):
    pid_file = tmp_path / 'game.pid'
    log = tmp_path / 'game.log'
    child = subprocess.Popen([sys.executable, str(ROOT / 'forge/run_project.py'),
                              '--project-root', str(project), '--pid-file', str(pid_file), '--log', str(log)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 10
        while not pid_file.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(.02)
        assert pid_file.exists(), child.poll()
        server_pid = int(pid_file.read_text())
        os.kill(server_pid, 0)
        child.send_signal(signal.SIGTERM)
        assert child.wait(timeout=10) == 130
        assert not pid_file.exists()
        with pytest.raises(ProcessLookupError):
            os.kill(server_pid, 0)
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=10)


def test_existing_pid_file_and_replaced_pid_file_are_preserved(project, tmp_path):
    path = tmp_path / 'owned-by-someone-else.pid'
    path.write_text('1\n')
    assert run_project.main(['--project-root', str(project), '--pid-file', str(path)]) == 1
    assert path.read_text() == '1\n'
    run_project._remove_owned_pid(path, 2)
    assert path.read_text() == '1\n'


@pytest.mark.parametrize('failure', ['npm', 'copy', 'symlink'])
def test_failed_relocation_cleans_only_new_destination(project, tmp_path, monkeypatch, failure):
    (project / 'package-lock.json').write_text('{}')
    target = tmp_path / 'new relocated game'
    if failure == 'copy':
        def bad_copy(*args, **kwargs):
            raise OSError('copy failed')
        monkeypatch.setattr(run_project.shutil, 'copytree', bad_copy)
    elif failure == 'npm':
        monkeypatch.setattr(run_project.subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a, 1, 'npm failed'))
    else:
        (project / 'linked').symlink_to(project / 'brief.json')
    with pytest.raises((RuntimeError, ValueError, OSError)):
        run_project.relocation_check(project, target)
    assert not target.exists()
    assert (project / 'brief.json').is_file()


def test_existing_relocation_destination_is_never_overwritten(project, tmp_path):
    (project / 'package-lock.json').write_text('{}')
    target = tmp_path / 'existing game'
    target.mkdir()
    (target / 'keep').write_text('user work')
    with pytest.raises(FileExistsError):
        run_project.relocation_check(project, target)
    assert (target / 'keep').read_text() == 'user work'


@pytest.fixture
def browser_project(project):
    target = project / 'node_modules/three/build/three.module.js'
    target.parent.mkdir(parents=True)
    shutil.copy2(ROOT / 'node_modules/three/build/three.module.js', target)
    return project


@pytest.mark.slow
def test_check_and_real_npm_relocation_use_local_assets_and_meaningful_input(browser_project):
    project = browser_project
    # Use the already pinned development lock, which contains only Three.js.
    shutil.copy2(ROOT / 'package.json', project / 'package.json')
    shutil.copy2(ROOT / 'package-lock.json', project / 'package-lock.json')
    for flags in ([], ['--relocate']):
        assert run_project.main(['--project-root', str(project), '--check', '--only', 'menu-board',
                                 '--output', 'evidence/relocation.json', *flags]) == 0
        report = json.loads((project / 'evidence/relocation.json').read_text())
        assert report['status'] == 'passed'
        run = report['runs'][0]
        observations = run['input']['observations']
        assert any(row['before']['selected'] != row['after']['selected'] for row in observations)
        assert all(row['after']['state'] == 'RUNNING' for row in observations)
        urls = [row['url'] for row in run['resources']]
        assert any('/vendor/three.module.js' in url for url in urls)
        assert any('/assets/interaction/MenuSelectionController.js' in url for url in urls)
        assert all(url.startswith('http://127.0.0.1:') for url in urls)


@pytest.mark.slow
@pytest.mark.parametrize('failure', ['missing_asset', 'external_request', 'no_input'])
def test_runner_refuses_missing_dependencies_and_unproven_input(browser_project, failure):
    project = browser_project
    run = project / 'runs/step3/menu-board'
    if failure == 'missing_asset':
        (project / 'assets/interaction/MenuSelectionController.js').unlink()
    elif failure == 'external_request':
        with (run / 'main.js').open('a') as stream:
            stream.write("\nfetch('https://example.invalid/runtime.json').catch(() => {});\n")
    else:
        card = json.loads((run / 'step3.json').read_text())
        card['input_checks'] = []
        (run / 'step3.json').write_text(json.dumps(card))
    with run_project.project_server(project) as info:
        report = run_project.check_project(project, info['url'], timeout=2)
    assert report['status'] == ('not_evaluated' if failure == 'no_input' else 'failed')
    if failure == 'external_request':
        assert any('external runtime request' in err for err in report['runs'][0]['errors'])


@pytest.mark.slow
def test_failed_image_channel_keeps_three_rounds_and_bounds_retries(browser_project, monkeypatch):
    project = browser_project
    run = project / 'runs/step3/menu-board'
    card = json.loads((run / 'step3.json').read_text())
    card['capabilities'] = ['discrete_state', 'autonomous_agents']
    (run / 'step3.json').write_text(json.dumps(card))
    # Read-only diagnostic fields on a turn/menu fixture test activation without navigation.
    source = (run / 'main.js').read_text().replace('state: parts.director.state,',
              "state: parts.director.state, diagnostics: {activation: true, blockedSeconds: 0},")
    (run / 'main.js').write_text(source)
    calls = []
    def failed_capture(*args, **kwargs):
        calls.append(kwargs)
        return {'status': 'not_evaluated', 'attempts': 3, 'review': 'not_evaluated'}
    monkeypatch.setattr(check_step3, 'image_preflight', failed_capture)
    assert check_step3.main(['--project-root', str(project), '--only', 'menu-board',
                            '--strategy', 'runs/step3/menu-board/strategy.json', '--output', 'evidence/play',
                            '--wall-seconds', '10', '--record-attempt']) == 0
    report = json.loads((project / 'evidence/play/report.json').read_text())
    assert [row['status'] for row in report['scenarios']] == ['passed'] * 3
    for scenario in report['scenarios']:
        samples = scenario['diagnostics']['samples']
        assert samples and len(samples) <= 64
        assert samples[0]['fields']['activation'] is True
    assert report['experience']['status'] == report['imageReview']['status'] == 'not_evaluated'
    assert all(row['imageReview']['status'] == 'not_evaluated' for row in report['scenarios'])
    assert report['scenarios'][1]['imageReview']['attempts'] == 0
    assert len(calls) == 1
    entry = attempts.reusable(project, 'step3:menu-board', artifact=run)
    assert entry and entry['result'] == 'passed'


@pytest.mark.slow
def test_optional_capture_failure_preserves_completed_playthrough(browser_project, monkeypatch):
    from playwright.sync_api import Page
    project = browser_project
    strategy = project / 'runs/step3/menu-board/strategy.json'
    plan = json.loads(strategy.read_text())
    plan['capture_when'] = {'state': 'RUNNING'}
    strategy.write_text(json.dumps(plan))
    calls, screenshot = [], Page.screenshot
    def fail_after_completed_rounds(page, **kwargs):
        calls.append(kwargs)
        if len(calls) > 3:
            raise TimeoutError('capture backend unavailable')
        return screenshot(page, **kwargs)
    monkeypatch.setattr(Page, 'screenshot', fail_after_completed_rounds)
    assert check_step3.main(['--project-root', str(project), '--only', 'menu-board',
                            '--strategy', 'runs/step3/menu-board/strategy.json', '--output', 'evidence/play',
                            '--wall-seconds', '10', '--record-attempt']) == 0
    report = json.loads((project / 'evidence/play/report.json').read_text())
    assert len(calls) == 4  # Three normal captures, then one bounded frozen-capture attempt.
    assert report['functional']['status'] == 'passed'
    assert [row['status'] for row in report['scenarios']] == ['passed'] * 3
    assert report['capture']['status'] == report['experience']['status'] == 'not_evaluated'
    assert 'capture backend unavailable' in report['capture']['reason']
    assert attempts.reusable(project, 'step3:menu-board')['result'] == 'passed'


@pytest.mark.slow
def test_scene_attempt_cannot_be_reused_as_behavior_pass(browser_project):
    from _shared.incremental import reusable_check
    project = browser_project
    run = project / 'runs/step3/menu-board'
    assert check_step1.main(['--project-root', str(project), '--runs', 'runs/step3',
                            '--record-attempt']) == 0
    scene = attempts.reusable(project, 'step1:menu-board')
    assert scene and scene['result'] == 'passed'
    assert scene['binding']['kind'] == 'scene'
    report = json.loads((project / scene['binding']['report']).read_text())
    assert report['functional']['scope'] == 'scene'
    assert report['input']['status'] == 'not_evaluated'
    assert attempts.reusable(project, 'step2:menu-board') is None
    assert reusable_check(project, run, 'behavior') is None
