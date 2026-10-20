"""Static scene coverage without requiring or executing gameplay inputs."""
import json
import shutil
from pathlib import Path

import pytest

import check_step1

ROOT = Path(__file__).resolve().parents[2]
THREE_SCENE = """
import { Scene, PerspectiveCamera, WebGLRenderer, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
const app = document.getElementById('app');
const scene = new Scene(), camera = new PerspectiveCamera(50, 960 / 600, .1, 100);
camera.position.z = 6;
const renderer = new WebGLRenderer();
renderer.setPixelRatio(1);
renderer.setSize(app.clientWidth || 960, app.clientHeight || 600, false);
app.append(renderer.domElement);
const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({color: 0x88bbff}));
box.name = 'subject'; scene.add(box);
window.__scene = { scene, camera };
renderer.render(scene, camera);
"""
OVERFLOW_SCENE = """
import { Scene, PerspectiveCamera, WebGLRenderer, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
const app = document.getElementById('app');
const scene = new Scene(), camera = new PerspectiveCamera(50, 960 / 600, .1, 100);
camera.position.z = 6;
const renderer = new WebGLRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(app.clientWidth || 960, app.clientHeight || 600, false);
app.append(renderer.domElement);
const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({color: 0x88bbff}));
box.name = 'subject'; scene.add(box);
window.__scene = { scene, camera };
renderer.render(scene, camera);
"""
DOM_SCENE = """
document.body.innerHTML = '<main id="board" style="width:600px;height:400px;background:#284b69;color:white">Command board</main>';
window.__scene = { root: document.querySelector('#board') };
"""
CANVAS_SCENE = """
document.body.innerHTML = '<main id="board"><canvas width="600" height="400"></canvas></main>';
const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
ctx.fillStyle = '#284b69'; ctx.fillRect(0, 0, 600, 400);
ctx.fillStyle = '#fff'; ctx.fillRect(50, 50, 100, 100);
window.__scene = { root: canvas };
"""


@pytest.fixture(scope='module')
def scene_browser(browser_dependencies):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_dependencies, headless=True,
                                    args=check_step1.browser_args())
        yield browser
        browser.close()


def scene_check(tmp_path, browser, source, *, binding=None, elements=None, theme=None,
                pin_canvas=True):
    run = tmp_path / 'runs/step1/static'
    run.mkdir(parents=True)
    canvas_css = ('#app canvas{display:block;width:100%;height:100%}'
                  if pin_canvas else '#app canvas{display:block}')
    (run / 'index.html').write_text(f'''<!doctype html><meta charset="utf-8"><title>Static fixture</title>
<link rel="icon" href="data:,"><style>
html,body{{margin:0;height:100%;overflow:hidden}}
#app{{position:absolute;inset:0}}
{canvas_css}
</style>
<script type="importmap">{{"imports":{{"three":"/vendor/three.module.js"}}}}</script>
<body><div id="app"></div>
<script type="module" src="./main.js"></script></body>''')
    (run / 'main.js').write_text(source)
    (run / 'brief.json').write_text(json.dumps({'scene': {'theme_elements': theme or [{'id': 'subject'}]}}))
    manifest = {'elements': elements if elements is not None else [
        {'id': 'subject', 'binding': binding or {'object': 'subject'}, 'custom_reason': 'Abstract scene fixture'}]}
    (run / 'scene-manifest.json').write_text(json.dumps(manifest))
    card = {'control_scheme': 'custom', 'player_modality': 'menu', 'core_verb': 'choose',
            'modules': [], 'controls': [], 'signature_actions': [], 'brief': 'brief.json',
            'scene_manifest': 'scene-manifest.json'}
    (run / 'step1.json').write_text(json.dumps(card))
    vendor = tmp_path / 'node_modules/three/build/three.module.js'
    vendor.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / 'node_modules/three/build/three.module.js', vendor)
    with check_step1.serving(run.parent, 'runs/step1', tmp_path) as url:
        errors = check_step1.check_run(browser, url, {'name': run.name, 'path': run, 'meta': card},
                                      'runs/step1', tmp_path / 'evidence', 200, False,
                                      project_root=tmp_path)
    return errors, json.loads((tmp_path / 'evidence/static.json').read_text())


@pytest.mark.slow
@pytest.mark.parametrize('source,binding', [
    (THREE_SCENE, {'object': 'subject'}), (DOM_SCENE, {'selector': '#board'}),
    (CANVAS_SCENE, {'selector': 'canvas'}),
])
def test_static_scene_needs_no_gameplay_adapter(tmp_path, scene_browser, monkeypatch, source, binding):
    monkeypatch.setattr(check_step1, 'check_inputs', lambda *a: pytest.fail('scene gate drove gameplay input'))
    errors, report = scene_check(tmp_path, scene_browser, source, binding=binding)
    assert not errors, errors
    assert report['static']['status'] == report['functional']['status'] == 'passed'
    assert report['functional']['scope'] == 'scene'
    assert report['input']['status'] == report['signature']['status'] == 'not_evaluated'
    assert not report['input']['observations']


@pytest.mark.slow
@pytest.mark.parametrize('options,expected', [
    ({'theme': [{'id': 'subject'}, {'id': 'goal'}]}, 'cover every brief theme element'),
    ({'binding': {'object': 'missing'}}, 'missing scene object'),
    ({'binding': {'selector': '#missing'}}, 'missing DOM element'),
    ({'elements': [{'id': 'subject', 'custom_reason': 'Missing binding'}]}, 'binding needs one'),
    ({'elements': [{'id': 'subject', 'binding': {'object': 'subject'}, 'asset': 'assets/missing.js'}]}, 'FileNotFoundError'),
    ({'theme': [{'id': 'arena', 'role': 'setting'}],
      'elements': [{'id': 'arena', 'binding': {'object': 'subject'},
                    'custom_reason': 'Hand-stacked concentric rings'}],
      'binding': {'object': 'subject'}},
     'must name a considered catalog'),
])
def test_scene_manifest_must_bind_the_whole_inventory(tmp_path, scene_browser, options, expected):
    errors, report = scene_check(tmp_path, scene_browser, THREE_SCENE, **options)
    assert any(expected in error for error in errors), errors
    assert report['functional']['status'] == 'failed'


@pytest.mark.slow
def test_custom_environment_records_the_catalog_it_skipped(tmp_path, scene_browser):
    errors, report = scene_check(
        tmp_path, scene_browser, THREE_SCENE,
        theme=[{'id': 'arena', 'role': 'setting'}],
        elements=[{
            'id': 'arena', 'binding': {'object': 'subject'},
            'custom_reason': 'Radial floor with one landmark, not a catalog arena.',
            'considered': 'assets/world/environment/ArenaLayout.js',
        }],
    )
    assert not errors, errors
    assert report['functional']['status'] == 'passed'


@pytest.mark.slow
def test_webgl_canvas_must_match_the_app_box_at_high_dpr(tmp_path, scene_browser):
    errors, report = scene_check(tmp_path, scene_browser, OVERFLOW_SCENE, pin_canvas=False)
    assert any('does not match container' in error for error in errors), errors
    assert report['functional']['status'] == 'failed'


SHELL_RESIZE_SCENE = """
import { Scene, PerspectiveCamera, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { createRenderer, installResize } from '/assets/user-interface/PrototypeShell.js';
const app = document.getElementById('app');
const renderer = createRenderer(app, { antialias: false, shadows: false });
const scene = new Scene();
const camera = new PerspectiveCamera(50, 1, .1, 100);
camera.position.z = 6;
const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({color: 0x88bbff}));
box.name = 'subject';
scene.add(box);
installResize(renderer, camera, app);
window.__scene = { scene, camera, renderer };
renderer.render(scene, camera);
"""


@pytest.mark.slow
def test_container_resize_updates_buffer_without_window_resize(tmp_path, scene_browser):
    run = tmp_path / 'runs/step1/static'
    run.mkdir(parents=True)
    (run / 'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Resize fixture</title>
<link rel="icon" href="data:,">
<style>
html,body{margin:0;height:100%;overflow:hidden}
#app{position:absolute;left:0;top:0;width:480px;height:320px}
#app canvas{display:block;width:100%;height:100%}
</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
<body><div id="app"></div>
<script type="module" src="./main.js"></script></body>''')
    (run / 'main.js').write_text(SHELL_RESIZE_SCENE)
    shell = tmp_path / 'assets/user-interface/PrototypeShell.js'
    shell.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / 'assets/user-interface/PrototypeShell.js', shell)
    vendor = tmp_path / 'node_modules/three/build/three.module.js'
    vendor.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / 'node_modules/three/build/three.module.js', vendor)
    with check_step1.serving(run.parent, 'runs/step1', tmp_path) as url:
        page = scene_browser.new_page(
            viewport={'width': 960, 'height': 600}, device_scale_factor=2)
        try:
            page.goto(f'{url}/runs/step1/static/', wait_until='load', timeout=20000)
            page.wait_for_function(
                "() => window.__scene && document.querySelector('#app canvas')")
            before = page.evaluate("""() => {
              const app = document.getElementById('app');
              const canvas = app.querySelector('canvas');
              const box = app.getBoundingClientRect();
              const r = canvas.getBoundingClientRect();
              return {
                innerWidth: window.innerWidth, innerHeight: window.innerHeight,
                dpr: window.devicePixelRatio,
                containerWidth: box.width, containerHeight: box.height,
                cssWidth: r.width, cssHeight: r.height,
                bufferWidth: canvas.width, bufferHeight: canvas.height,
                aspect: window.__scene.camera.aspect,
              };
            }""")
            page.evaluate("""() => {
              const app = document.getElementById('app');
              app.style.width = '720px';
              app.style.height = '400px';
            }""")
            page.wait_for_function("""() => {
              const canvas = document.querySelector('#app canvas');
              return canvas && canvas.width === 1440 && canvas.height === 800;
            }""")
            after = page.evaluate("""() => {
              const app = document.getElementById('app');
              const canvas = app.querySelector('canvas');
              const box = app.getBoundingClientRect();
              const r = canvas.getBoundingClientRect();
              return {
                innerWidth: window.innerWidth, innerHeight: window.innerHeight,
                containerWidth: box.width, containerHeight: box.height,
                cssWidth: r.width, cssHeight: r.height,
                bufferWidth: canvas.width, bufferHeight: canvas.height,
                aspect: window.__scene.camera.aspect,
              };
            }""")
        finally:
            page.close()
    assert before['dpr'] == 2
    assert abs(before['containerWidth'] - 480) < 1.5
    assert abs(before['containerHeight'] - 320) < 1.5
    assert abs(before['cssWidth'] - before['containerWidth']) < 1.5
    assert abs(before['cssHeight'] - before['containerHeight']) < 1.5
    assert before['bufferWidth'] == 960
    assert before['bufferHeight'] == 640
    assert abs(before['aspect'] - 480 / 320) < 1e-6
    assert after['innerWidth'] == before['innerWidth']
    assert after['innerHeight'] == before['innerHeight']
    assert abs(after['containerWidth'] - 720) < 1.5
    assert abs(after['containerHeight'] - 400) < 1.5
    assert abs(after['cssWidth'] - after['containerWidth']) < 1.5
    assert abs(after['cssHeight'] - after['containerHeight']) < 1.5
    assert after['bufferWidth'] == 1440
    assert after['bufferHeight'] == 800
    assert abs(after['aspect'] - 720 / 400) < 1e-6


@pytest.mark.slow
@pytest.mark.parametrize('source,binding', [
    (THREE_SCENE + 'setInterval(() => {box.rotation.y += .1; renderer.render(scene, camera);}, 20);', {'object': 'subject'}),
    (DOM_SCENE + "document.querySelector('#board').animate([{opacity: 1}, {opacity: .5}], {duration: 1000, iterations: Infinity});", {'selector': '#board'}),
    (CANVAS_SCENE + "window.__scene.root = document.querySelector('#board'); let x=1; setInterval(() => ctx.fillRect(x++, 200, 10, 10), 20);", {'selector': 'canvas'}),
])
def test_scene_rejects_motion_and_animation(tmp_path, scene_browser, source, binding):
    errors, report = scene_check(tmp_path, scene_browser, source, binding=binding)
    assert any('static scene changed' in error for error in errors), errors
    assert report['static']['status'] == 'failed'


@pytest.mark.slow
@pytest.mark.parametrize('source,expected', [
    (THREE_SCENE.replace('window.__scene = { scene, camera };', ''), 'expose window.__scene'),
    (THREE_SCENE + 'box.position.z = 100; renderer.render(scene, camera);', 'no framed drawable'),
    (DOM_SCENE + "window.__scene.root.style.display = 'none';", 'scene surface has zero size'),
])
def test_scene_requires_a_framed_surface(tmp_path, scene_browser, source, expected):
    errors, report = scene_check(tmp_path, scene_browser, source)
    assert any(expected in error for error in errors), errors
    assert report['functional']['status'] == 'failed'


def test_find_chromium_honours_the_environment(monkeypatch) -> None:
    monkeypatch.setenv("GBDATA_CHROMIUM", "/custom/chrome")
    assert check_step1.find_chromium() == "/custom/chrome"


def test_software_gl_args_force_a_working_swiftshader_context() -> None:
    # A GPU-less host must still get WebGL, or every run fails for the wrong reason.
    args = check_step1.SOFTWARE_GL_ARGS
    assert "--use-angle=swiftshader-webgl" in args
    assert "--enable-unsafe-swiftshader" in args


def test_missing_run_name_is_an_error(tmp_path) -> None:
    runs_dir = ROOT / "forge" / "tests" / ".fixtures" / "absent"
    assert check_step1.main(["--runs", str(runs_dir), "--only", "definitely-not-a-run", "--output", ""]) == 2
