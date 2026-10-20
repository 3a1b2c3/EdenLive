"""Exercise optional isolated UI fixtures and reusable UI factory behavior."""
import json
import shutil

import pytest

import check_ui
import run_project
import ui
from _shared.ui_evidence import snapshot, tree
from scaffold import ROOT, encoded
from test_standalone_project import project

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded(value))

def create_preview(root, run):
    config = {'components': [
        {'id': 'title', 'type': 'brand', 'label': 'Route puzzle'},
        {'id': 'moves', 'type': 'metric', 'label': 'Moves', 'dock': 'top-right'},
        {'id': 'objective', 'type': 'panel', 'label': 'Objective', 'dock': 'bottom-left'},
        {'id': 'hint', 'type': 'controls', 'label': 'Controls', 'dock': 'bottom-right'},
        {'id': 'result', 'type': 'dialog', 'label': 'Result', 'buttons': [{'id': 'restart', 'label': 'Play again'}]}
    ]}
    state = {'title': {'value': 'Choose a path'}, 'moves': {'value': 4},
             'objective': {'value': 'Find the open route', 'text': 'Read the conditions before committing.'},
             'hint': {'text': 'Arrow keys: select\nEnter: confirm'}, 'result': {'visible': False}}
    fixtures = [{'name': 'normal', 'state': state}, {'name': 'ended', 'state': {
        **state, 'result': {'visible': True, 'value': 'Complete', 'text': 'The selected route reaches home.'}}}]
    ui.prepare(root, run, 'create', config, fixtures)
    return config, fixtures

def create_status_preview(root, run):
    config = {'components': [
        {'id': 'title', 'type': 'brand', 'label': 'Evacuation'},
        {'id': 'health', 'type': 'meter', 'label': 'Health'},
        {'id': 'time', 'type': 'metric', 'label': 'Time remaining', 'dock': 'top-right'},
        {'id': 'objective', 'type': 'panel', 'label': 'Objective', 'dock': 'bottom-left'},
        {'id': 'hint', 'type': 'controls', 'label': 'Controls', 'dock': 'bottom-right'},
        {'id': 'result', 'type': 'dialog', 'label': 'Round result', 'buttons': [
            {'id': 'restart', 'label': 'Play again'}]},
        {'id': 'pause', 'type': 'dialog', 'label': 'Pause menu', 'variant': 'paused', 'buttons': [
            {'id': 'resume', 'label': 'Continue'},
            {'id': 'restart', 'label': 'Restart', 'kind': 'secondary'}]},
        {'id': 'chapter', 'type': 'banner'},
        {'id': 'seals', 'type': 'tracker', 'label': 'Seals', 'dock': 'top-center', 'count': 2}
    ]}
    state = {'title': {'value': 'LAST EXIT'},
             'health': {'value': 82, 'max': 100, 'displayValue': '82 / 100'},
             'time': {'value': '01:09'},
             'objective': {'value': 'Reach the safe zone', 'text': 'Follow the marked route to extraction.'},
             'hint': {'text': 'WASD: move\nEsc: pause'},
             'result': {'visible': False}, 'pause': {'visible': False},
             'chapter': {'visible': False}, 'seals': {'value': 1, 'displayValue': '1 / 2'}}
    stats = [{'label': 'Time', 'value': '69s'}, {'label': 'Rescued', 'value': 3},
             {'label': 'Health', 'value': '82%'}]
    fixtures = [
        {'name': 'running', 'state': state},
        {'name': 'low-health', 'state': {**state, 'health': {'value': 1, 'max': 100, 'displayValue': '1 / 100'}}},
        {'name': 'paused', 'state': {**state, 'pause': {
            'visible': True, 'value': 'Take a breath', 'text': 'Your progress is held. Continue when ready.'}}},
        {'name': 'won', 'state': {**state, 'result': {
            'visible': True, 'variant': 'success', 'value': 'Made it out',
            'text': 'Everyone reached the safe zone.', 'stats': stats}}},
        {'name': 'lost', 'state': {**state, 'health': {'value': 0, 'max': 100, 'displayValue': '0 / 100'},
            'result': {'visible': True, 'variant': 'failure', 'value': '未能抵达撤离点',
                       'text': '生命值耗尽，撤离行动结束。重新开始后，请留意危险区域并规划一条更安全的路线。',
                       'stats': [*stats[:2], {'label': 'Health', 'value': '0%'}]}}}
    ]
    ui.prepare(root, run, 'create', config, fixtures)
    return config, fixtures

@pytest.mark.parametrize('mode', ['create', 'adapt'])
def test_prepare_is_idempotent_and_conflicts_preflight_without_writes(project, mode):
    run = project / 'runs/step3/menu-board'
    config = {'components': [{'id': 'moves', 'type': 'metric'}]} if mode == 'create' else {
        'roots': ['#hud'], 'roles': {'panel': ['#hud']}}
    fixtures = [{'name': 'normal', 'state' if mode == 'create' else 'dom': {}}]
    before = snapshot(project, run)
    ui.prepare(project, run, mode, config, fixtures, dry_run=True)
    assert snapshot(project, run) == before
    ui.prepare(project, run, mode, config, fixtures)
    after = snapshot(project, run)
    ui.prepare(project, run, mode, config, fixtures)
    assert snapshot(project, run) == after
    runtime = project / 'assets/user-interface/GameUiFactory.js'
    runtime.write_text('user customization')
    before = snapshot(project, run)
    for dry in (False, True):
        with pytest.raises(ValueError, match='conflicting'):
            ui.prepare(project, run, mode, config, fixtures, dry_run=dry)
        assert snapshot(project, run) == before

@pytest.mark.slow
def test_status_cards_and_resource_displays_in_browser(project, browser_dependencies):
    from playwright.sync_api import sync_playwright
    from _shared.runtime import browser_args
    run = project / 'runs/step3/menu-board'
    create_status_preview(project, run)
    with run_project.project_server(project) as server:
        report = check_ui.preview(project, run, server['url'], run / 'evidence/ui')
        assert report['status'] == 'passed', report
        assert len(report['frames']) == 5
        assert all(frame['screenshot'] for frame in report['frames'])
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=browser_dependencies, args=browser_args(False))
            try:
                page = browser.new_page()
                page.goto(server['url'] + '/runs/step3/menu-board/ui/preview.html')
                page.wait_for_function('window.__uiPreview')
                observed = page.evaluate('''async () => {
                  document.body.replaceChildren();
                  const {mountUI} = await import('./view.js');
                  const calls = [];
                  const ui = mountUI({actions: {restart: () => calls.push('restart'), resume: () => calls.push('resume')},
                    state: window.__uiPreview.cases[0].state});
                  const meter = ui.elements.health.querySelector('progress');
                  const formatted = ui.elements.health.querySelector('.gbui__value').textContent;
                  const initial = {value: meter.value, max: meter.max};
                  ui.update({health: {value: 120, max: 100}});
                  const upper = meter.value;
                  ui.update({health: {value: -3, max: 100}});
                  const lower = meter.value;
                  const result = ui.elements.result;
                  const stats = result.querySelector('dl');
                  ui.update(window.__uiPreview.cases[3].state);
                  const success = result.classList.contains('gbui__dialog--success');
                  const icon = result.querySelector('.gbui__icon');
                  const successIcon = icon.textContent;
                  const decorative = icon.getAttribute('aria-hidden');
                  const summary = [...stats.querySelectorAll('.gbui__stat')].map(el => ({
                    label: el.querySelector('dt').textContent, value: el.querySelector('dd').textContent}));
                  const dirty = {visible:true,variant:'failure',value:'<b>Lost</b>',icon:'<svg>',
                    stats:[{label:'<img src=x>',value:'<script>bad()</script>'}]};
                  ui.update({result: dirty});
                  const failure = result.classList.contains('gbui__dialog--failure') && !result.classList.contains('gbui__dialog--success');
                  const escaped = !result.querySelector('img,svg,script,b') && icon.textContent === '<svg>' &&
                    stats.querySelector('dt').textContent === '<img src=x>' && stats.querySelector('dd').textContent === '<script>bad()</script>';
                  dirty.stats[0].value = '0'; ui.update({result: dirty});
                  const mutableStat = stats.querySelector('dd').textContent;
                  ui.update({result:{visible:true,variant:'paused',value:'Paused'}});
                  const cleared = stats.hidden && !stats.children.length;
                  const pauseIcon = icon.textContent;
                  ui.update({result:{visible:true,value:'Neutral',icon:''}});
                  const neutral = result.classList.contains('gbui__dialog--neutral') && icon.hidden;
                  ui.update(window.__uiPreview.cases[2].state);
                  const pause = ui.elements.pause;
                  const pauseDefault = pause.classList.contains('gbui__dialog--paused') && result.hidden;
                  const buttons = [...pause.querySelectorAll('button')];
                  const hierarchy = buttons[0].classList.contains('gbui__button--primary') && buttons[1].classList.contains('gbui__button--secondary');
                  buttons.forEach(button => button.click());
                  ui.dispose();
                  return {formatted,initial,upper,lower,success,successIcon,decorative,summary,
                    failure,escaped,mutableStat,cleared,pauseIcon,neutral,pauseDefault,hierarchy,calls};
                }''')
                assert observed == {
                    'formatted': '82 / 100', 'initial': {'value': 82, 'max': 100}, 'upper': 100, 'lower': 0,
                    'success': True, 'successIcon': '↗', 'decorative': 'true',
                    'summary': [{'label': 'Time', 'value': '69s'}, {'label': 'Rescued', 'value': '3'},
                                {'label': 'Health', 'value': '82%'}],
                    **dict.fromkeys(['failure', 'escaped', 'cleared', 'neutral', 'pauseDefault', 'hierarchy'], True),
                    'mutableStat': '0', 'pauseIcon': 'Ⅱ', 'calls': ['resume', 'restart']}
            finally:
                browser.close()

@pytest.mark.slow
def test_browser_factory_state_actions_modal_and_adapter_identity(project, browser_dependencies):
    from playwright.sync_api import sync_playwright
    from _shared.runtime import browser_args
    run = project / 'runs/step3/menu-board'
    create_preview(project, run)
    shutil.copy2(ROOT / 'assets/user-interface/GameUiAdapter.js', project / 'assets/user-interface/GameUiAdapter.js')
    with run_project.project_server(project) as server, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_dependencies, args=browser_args(False))
        try:
            page = browser.new_page()
            page.goto(server['url'] + '/runs/step3/menu-board/ui/preview.html')
            page.wait_for_function('window.__uiPreview')
            result = page.evaluate('''async () => {
              document.body.replaceChildren();
              const {createGameUI} = await import('/assets/user-interface/GameUiFactory.js');
              const {adaptGameUI} = await import('/assets/user-interface/GameUiAdapter.js');
              const prior = document.createElement('button'); prior.textContent='Outside'; document.body.append(prior); prior.focus();
              let calls=0,bubbled=0; document.addEventListener('keydown',()=>bubbled++);
              const mutable={value:2};
              const ui=createGameUI({components:[{id:'moves',type:'metric'}, {id:'custom',type:'slot'},
                {id:'result',type:'dialog',buttons:[{id:'restart',label:'Again'},{id:'close',label:'Close'}]}],
                actions:{restart:()=>calls++,close:()=>{}},state:{moves:mutable}});
              const node=ui.elements.moves; mutable.value=3; ui.update({moves:mutable,missing:{value:90}});
              const mutation=node.querySelector('.gbui__value').textContent==='3';
              ui.update({moves:{visible:false},result:{visible:true,value:'Complete'}});
              const buttons=ui.elements.result.querySelectorAll('button');
              const hidden=getComputedStyle(node).display==='none';
              const focused=document.activeElement===buttons[0];
              buttons[1].focus(); buttons[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
              const trap=document.activeElement===buttons[0]; buttons[0].click();
              ui.update({result:{visible:false}}); const restored=document.activeElement===prior;
              ui.dispose();ui.dispose();ui.update({moves:mutable});
              const detached=!node.isConnected;
              const root=document.createElement('div');root.id='existing';root.style.cssText='position:absolute;left:70px;top:40px;width:230px';
              const button=document.createElement('button');button.id='existing-action';button.textContent='Original';root.append(button);document.body.append(root);
              button.addEventListener('click',()=>calls++);
              const before=root.getBoundingClientRect().toJSON();
              const adapter=adaptGameUI({roots:['#existing'],roles:{panel:['#existing'],button:['#existing-action']}});
              button.click();const after=root.getBoundingClientRect().toJSON();
              const identity=document.querySelector('#existing-action')===button && button.textContent==='Original';
              const geometry=before.x===after.x && before.y===after.y && before.width===after.width;
              adapter.dispose();adapter.dispose();
              let rolledBack=false;try{adaptGameUI({roots:['#existing'],roles:{button:['#absent']}})}catch{rolledBack=!root.classList.contains('gbui')}
              return {mutation,hidden,focused,trap,restored,detached,identity,geometry,rolledBack,calls,bubbled};
            }''')
            assert result == {**dict.fromkeys(['mutation','hidden','focused','trap','restored','detached','identity','geometry','rolledBack'], True), 'calls': 2, 'bubbled': 0}
        finally:
            browser.close()

@pytest.mark.slow
def test_adapt_preview_strips_game_scripts_and_checks_existing_menu(project):
    run = project / 'runs/step3/menu-board'
    # Pure menu fixture: these actions already exist before any appearance work.
    (run / 'index.html').write_text('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>#hud{position:absolute;left:16px;top:16px;width:280px}#overlay{position:fixed;inset:0}</style></head><body>
    <div id="hud"><h2 id="title">Choose a route</h2><button id="choose">Confirm</button></div>
    <div id="overlay" hidden><div class="result-card"><h2 id="result">Complete</h2><button id="restart">Again</button></div></div>
    <script>throw new Error('inline gameplay ran')</script><script type="module" src="./main.js"></script></body></html>''')
    config = {'roots': ['#hud', '#overlay'], 'roles': {'panel': ['#hud'], 'dialog': ['#overlay'],
        'card': ['.result-card'], 'value': ['#title', '#result'], 'button': ['#choose', '#restart']}}
    fixtures = [{'name': 'choosing', 'dom': {}}, {'name': 'ended', 'dom': {'#overlay': {'hidden': False}}}]
    ui.prepare(project, run, 'adapt', config, fixtures)
    with run_project.project_server(project) as server:
        report = check_ui.preview(project, run, server['url'])
    assert report['status'] == 'passed', report
    assert len(report['frames']) == 2
    assert tree(project, run)['main.js']

@pytest.mark.slow
def test_custom_ui_preview_checks_selected_layout_without_factory(project):
    run = project / 'runs/step3/menu-board'
    view = run / 'ui'; view.mkdir()
    (view / 'preview.html').write_text('''<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0}#interface{padding:16px}.readout{pointer-events:none}</style>
    </head><body><main id="interface"><h2 class="readout">Choose a route</h2>
    <button>Confirm</button></main><script src="./preview.js"></script></body></html>''')
    script = '''window.__uiPreview = {
      mode: 'custom', cases: [{name: 'choosing'}], actions: [],
      selectors: {roots: '#interface', components: '.readout, button', passive: '.readout'},
      show() { document.querySelector('.readout').style.transform = 'translateX(0px)'; }
    };'''
    (view / 'preview.js').write_text(script)
    with run_project.project_server(project) as server:
        report = check_ui.preview(project, run, server['url'])
    assert report['status'] == 'passed', report
    assert all(frame['layout']['visible'] == 2 for frame in report['frames'])
    assert not (project / 'assets/user-interface/GameUiFactory.js').exists()
    (view / 'preview.js').write_text(script.replace('translateX(0px)', 'translateX(2000px)'))
    with run_project.project_server(project) as server:
        report = check_ui.preview(project, run, server['url'])
    assert report['status'] == 'failed'
    assert all(frame['layout']['outside'] == ['readout'] for frame in report['frames'])
