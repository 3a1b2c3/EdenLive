"""Real-input behavior gate regressions for forge/check_step2.py.

The point of the checker is that it FAILS on a broken prototype. A checker that
passes everything is worse than none, so the load-bearing tests here are the
failing mutations: a run that throws on import, one that renders nothing, and one
that ignores its own controls must each be reported.

The browser tests need Playwright's Chromium and take a few seconds each; they
skip cleanly when it is unavailable.
"""

import json
import os
import shutil
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "forge"))

import check_step1  # shared browser implementation
import check_step2  # noqa: E402

TEMPLATE = REPO_ROOT / "assets" / "template" / "index.html"

# A minimal working prototype: draws one lit mesh in front of the camera and
# accepts Enter to rotate a real scene object. Its HUD deliberately stays static.
GOOD_MAIN_JS = """
import {
  BoxGeometry, Clock, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';

export async function start() {
  const container = document.getElementById('app');
  const hud = document.getElementById('hud');

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(container.clientWidth || 960, container.clientHeight || 600, false);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0, 0);
  scene.add(new DirectionalLight(0xffffff, 1.2));
  const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: 0x88bbff }));
  box.name = 'subject';
  scene.add(box);

  let presses = 0;
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter') { presses += 1; box.rotation.y = Math.PI / 2; } });
  window.__gameTest = Object.freeze({read: () => ({turned: box.rotation.y > 1})});

  // The checker requires this handle so it can verify the scene is actually in
  // front of the camera; without it the framing check cannot run and the run
  // fails. Every real prototype exposes it too.
  window.__scene = { scene, camera };

  const clock = new Clock();
  function frame() {
    const delta = Math.min(clock.getDelta(), 1 / 20);
    hud.textContent = 'Enter: turn the block';
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
"""

# A prototype whose right-click handler fires and logs, but whose frame loop
# rebuilds the state it just cleared. This is a bug a reference run shipped, in
# miniature:
# `selected` is set to null on right-click, then immediately restored because the
# loop re-derives it from "is the pointer over the canvas" rather than from an
# actual pointer movement. The HUD's log row changes, so every other check passes.
REVERTING_RIGHT_CLICK_MAIN_JS = """
import {
  BoxGeometry, Clock, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';

export async function start() {
  const container = document.getElementById('app');
  const hud = document.getElementById('hud');

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(container.clientWidth || 960, container.clientHeight || 600, false);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0, 0);
  scene.add(new DirectionalLight(0xffffff, 1.2));
  const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: 0x88bbff }));
  box.name = 'subject';
  scene.add(box);
  window.__scene = { scene, camera };

  let inside = false;
  let selected = null;
  window.__gameTest = Object.freeze({read: () => ({selected})});
  let lastAction = 'none';
  renderer.domElement.addEventListener('pointermove', () => { inside = true; });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 2) return;
    selected = null;
    lastAction = 'cancelled selection';
  });

  const clock = new Clock();
  function frame() {
    clock.getDelta();
    // The bug: `inside` stays true while hovering, so the cancel above is undone
    // on the very next frame and the control is dead to the player.
    if (inside) selected = 'pad-4-2';
    hud.textContent = `selected ${selected ?? '-'}\\nlast action ${lastAction}`;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
"""

# The same prototype with the latch that makes the cancel stick.
PERSISTING_RIGHT_CLICK_MAIN_JS = REVERTING_RIGHT_CLICK_MAIN_JS.replace(
    "renderer.domElement.addEventListener('pointermove', () => { inside = true; });",
    "let cancelled = false;\n"
    "  renderer.domElement.addEventListener('pointermove', () => "
    "{ inside = true; cancelled = false; });",
).replace(
    "    selected = null;\n    lastAction = 'cancelled selection';",
    "    selected = null;\n    cancelled = true;\n    lastAction = 'cancelled selection';",
).replace(
    "if (inside) selected = 'pad-4-2';",
    "if (inside && !cancelled) selected = 'pad-4-2';",
)

THROWING_MAIN_JS = """
export async function start() {
  throw new Error('deliberate behavior failure');
}
"""

# Renders nothing: a canvas that is only ever cleared to one colour.
BLANK_MAIN_JS = """
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export async function start() {
  const container = document.getElementById('app');
  const hud = document.getElementById('hud');

  const renderer = new WebGLRenderer();
  renderer.setPixelRatio(1);
  renderer.setSize(960, 600, false);
  container.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  hud.textContent = 'nothing to see';
  renderer.render(scene, camera);
}
"""

# Animated HUD and rendered scene, but the gameplay action is disconnected.
DEAF_MAIN_JS = GOOD_MAIN_JS.replace("box.rotation.y = Math.PI / 2;", "")
DEAF_MAIN_JS = DEAF_MAIN_JS.replace("hud.textContent = 'Enter: turn the block';", "hud.textContent = `animation ${performance.now()}`;")

INPUT_CHECKS = [{"name": "turn block", "before": {"turned": False},
                 "actions": [{"type": "tap", "key": "Enter"}], "expect": {"turned": True}}]
SELECTION_CHECKS = [
    {"name": "select", "actions": [{"type": "move", "x": 480, "y": 350}], "expect": {"selected": "pad-4-2"}},
    {"name": "cancel", "actions": [{"type": "click", "x": 480, "y": 350, "button": "right"}], "expect": {"selected": None}},
]


def _write_run(runs_dir: Path, name: str, main_js: str, controls=("any key",)) -> None:
    run = runs_dir / name
    # exist_ok, because the fixture paths below are fixed: a run killed mid-test (Ctrl-C, a
    # timeout, a crashed browser) leaves the directory behind and every later run then fails on
    # FileExistsError rather than on anything about the code under test.
    run.mkdir(parents=True, exist_ok=True)
    (run / "index.html").write_text(
        TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    (run / "main.js").write_text(main_js, encoding="utf-8")
    # scaffold init copies the loop helper into every run, so the fixture serves it too.
    (run / "game-loop.mjs").write_text(
        (TEMPLATE.parent / "game-loop.mjs").read_text(encoding="utf-8"), encoding="utf-8"
    )
    from test_validate import minimal_brief
    brief = minimal_brief()
    brief['core_verb'] = 'turn or select'
    brief['scene']['theme_elements'] = [{'id': 'subject', 'label': 'Block', 'role': 'prop'}]
    (run / 'scene-manifest.json').write_text(json.dumps({'elements': [
        {'id': 'subject', 'binding': {'object': 'subject'}, 'custom_reason': 'Intentional abstract block'}]}))
    (run / 'brief.json').write_text(json.dumps(brief))
    checks = SELECTION_CHECKS if 'selected' in main_js else INPUT_CHECKS
    (run / "step2.json").write_text(
        json.dumps({"control_scheme": "custom", "player_modality": "cursor", "core_verb": "turn or select",
                    "modules": [], "controls": list(controls),
                    "brief": "brief.json", "input_checks": checks,
                    "scene_manifest": "scene-manifest.json", "capabilities": ["discrete_state"],
                    "capability_checks": {"discrete_state": [c["name"] for c in checks]},
                    "signature_actions": [{"id": "interaction", "brief_refs": ["/core_verb"],
                                           "action": "Turn or select the displayed object", "feedback": "The object turns or its selection changes",
                                           "success_checks": [checks[0]['name']],
                                           "boundary": {"checks": [checks[1]['name']]} if len(checks) > 1 else
                                                       {"skip_reason": "A single persistent turn has no held or rejected state; the case asserts its lasting result."}}]}), encoding="utf-8"
    )


def _run_checker(runs_dir: Path, only: str) -> int:
    """Invoke the checker in-process against a temporary runs directory."""
    return check_step2.main(
        [
            "--runs",
            str(runs_dir.relative_to(REPO_ROOT)),
            "--only",
            only,
            "--output",
            "",
        ]
    )


@pytest.fixture
def preflight_browser(browser_dependencies):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=browser_dependencies, headless=True,
                                             args=check_step1.browser_args())
        yield browser
        browser.close()


def preflight_run(tmp_path, browser, main_js, *, game_js=None, checks=None, card_update=None):
    # Standalone fixture: serve only its copied dependencies, never other games.
    runs = tmp_path / 'runs/step2'
    _write_run(runs, 'preflight', main_js)
    vendor = tmp_path / 'node_modules/three/build/three.module.js'
    vendor.parent.mkdir(parents=True)
    shutil.copyfile(REPO_ROOT / 'node_modules/three/build/three.module.js', vendor)
    for relative in ('assets/user-interface/PrototypeShell.js', 'assets/math/TimeUtils.js'):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO_ROOT / relative, target)
    run = runs / 'preflight'
    if game_js is not None:
        (run / 'game.mjs').write_text(game_js)
    card = json.loads((run / 'step2.json').read_text())
    if checks is not None:
        card['input_checks'] = checks
    if card_update:
        card.update(card_update)
        (run / 'step2.json').write_text(json.dumps(card), encoding='utf-8')
    with check_step1.serving(runs, 'runs/step2', tmp_path) as base_url:
        problems = check_step1.check_run(
            browser, base_url, {'name': run.name, 'path': run, 'meta': card},
            'runs/step2', tmp_path / 'evidence', 0, True, stage='behavior', project_root=tmp_path)
    report = json.loads((tmp_path / 'evidence/preflight.json').read_text())
    return problems, report


@pytest.mark.slow
@pytest.mark.parametrize('mutation,expected', [
    ("console.error('startup console failure');", 'console.error: startup console failure'),
    ("queueMicrotask(() => { throw new Error('startup exception'); });", 'uncaught: startup exception'),
    ("await fetch('./missing-startup.json');", 'HTTP 404'),
    ("window.__gameTest = { read: () => ({ frame: { id: 1, rawDt: NaN } }) };", 'rawDt must be finite'),
    ("window.__gameTest = { read: () => ({ frame: { id: 1, rawDt: -1 } }) };", 'rawDt must be finite'),
    ("window.__gameTest = { read: () => ({ frame: { id: -1, rawDt: 0 } }) };", 'id must be a nonnegative integer'),
    ("window.__gameTest = { read: () => ({ frame: null }) };", 'game frame must be an object'),
])
def test_startup_failure_never_drives_input(tmp_path, preflight_browser, monkeypatch, mutation, expected):
    def forbidden_input(*args):
        pytest.fail('The checker drove input after startup had already failed')
    monkeypatch.setattr(check_step1, 'check_inputs', forbidden_input)
    main_js = GOOD_MAIN_JS.replace('window.__scene = { scene, camera };',
                                  'window.__scene = { scene, camera };\n' + mutation)
    problems, report = preflight_run(tmp_path, preflight_browser, main_js)
    assert any(expected in problem for problem in problems), problems
    assert report['preflight']['status'] == 'failed'
    assert report['input']['status'] == 'not_evaluated'
    assert report['input']['observations'] == []


@pytest.mark.slow
def test_discrete_template_boots_and_drives_real_input(tmp_path, preflight_browser):
    # Stage 2 selects a mode and supplies an input adapter; the rest of the template is unchanged.
    main_js = (TEMPLATE.parent / 'main.js').read_text().replace(
        "import { createRenderer, installResize }",
        "import { createRenderer, installResize, KeyState }").replace(
        'createGame()', 'createGame(scene.children[0])').replace(
        "{ mode: 'static' }",
        "{ mode: 'discrete', input: new KeyState({ Enter: 'confirm' }).attach(window) }").replace(
        'window.__scene =', "scene.children[0].name = 'subject'; window.__scene =")
    game_js = """
export function createGame(box) {
  return {
    handleInput(input) { if (input.consumePress('confirm')) box.rotation.y = Math.PI / 2; },
    update() { throw new Error('Discrete input must not depend on a simulation tick'); },
    read: () => ({ turned: box.rotation.y > 1 }),
  };
}
"""
    problems, report = preflight_run(tmp_path, preflight_browser, main_js,
                                    game_js=game_js)
    assert not problems, problems
    assert report['preflight']['status'] == 'passed'
    assert report['preflight']['frame']['source'] == 'game snapshot'
    assert report['preflight']['frame']['id'] >= 1
    assert report['preflight']['frame']['rawDt'] >= 0
    assert report['input']['status'] == 'passed'
    assert report['functional']['status'] == 'passed'
    assert report['input']['observations']


@pytest.mark.slow
@pytest.mark.parametrize('mode', ['discrete', 'fixed'])
def test_clock_can_start_with_first_input(tmp_path, preflight_browser, mode):
    # A valid initial render needs no tick. Even continuous play may await a start input.
    prefix = GOOD_MAIN_JS.split('  const clock = new Clock();', 1)[0]
    main_js = "import { FrameStepper } from '/assets/math/TimeUtils.js';\n" + prefix + f"""
  const stepper = new FrameStepper({{ mode: {json.dumps(mode)} }});
  window.__gameTest = Object.freeze({{ read: () => ({{
    turned: box.rotation.y > 1, frame: {{ ...stepper.frame }}, clock: stepper.read(),
  }}) }});
  renderer.render(scene, camera);
  window.addEventListener('keydown', event => {{
    if (event.key !== 'Enter') return;
    stepper.advance(0, () => {{}});
    renderer.render(scene, camera);
  }});
}}
"""
    checks = [{**INPUT_CHECKS[0], 'before': {'turned': False, 'frame.id': 0},
               'expect': {'turned': True, 'frame.id': 1}}]
    problems, report = preflight_run(tmp_path, preflight_browser, main_js,
                                    checks=checks)
    assert not problems, problems
    assert report['preflight']['status'] == 'passed'
    assert report['preflight']['frame']['status'] == 'not_evaluated'
    assert report['preflight']['frame']['id'] == 0
    assert report['input']['status'] == 'passed'
    assert report['runtime']['frame']['status'] == 'passed'
    assert report['runtime']['frame']['id'] == 1


@pytest.mark.slow
def test_clock_error_after_first_input_is_reported(tmp_path, preflight_browser):
    main_js = GOOD_MAIN_JS.replace('window.__scene = { scene, camera };', """
window.__scene = { scene, camera };
window.addEventListener('keydown', () => {
  window.__gameTest = { read: () => ({ turned: box.rotation.y > 1, frame: { id: 1, rawDt: NaN } }) };
});
""")
    problems, report = preflight_run(tmp_path, preflight_browser, main_js)
    assert any('after input: game frame rawDt must be finite' in problem for problem in problems)
    assert report['input']['status'] == 'passed'
    assert report['runtime']['frame']['status'] == 'failed'
    assert report['functional']['status'] == 'failed'


@pytest.mark.slow
def test_catalog_modules_provenance_without_import_fails(tmp_path, preflight_browser, monkeypatch):
    def forbidden_input(*args):
        pytest.fail('The checker drove input after a forged catalog import')
    monkeypatch.setattr(check_step1, 'check_inputs', forbidden_input)
    problems, report = preflight_run(
        tmp_path, preflight_browser, GOOD_MAIN_JS,
        card_update={
            'capabilities': ['discrete_state', 'continuous_motion'],
            'capability_checks': {
                'discrete_state': ['turn block'],
                'continuous_motion': ['turn block'],
            },
            'modules': ['/assets/camera/OrbitFollowCameraRig.js'],
            'implementation': {
                'controllers': [],
                'camera': 'custom',
                'input_model': 'custom',
            },
        },
    )
    assert any('does not import' in problem for problem in problems), problems
    assert report['functional']['status'] == 'failed'
    assert report['input']['status'] == 'not_evaluated'


@pytest.mark.slow
def test_custom_clock_uses_labelled_passive_preflight(tmp_path, preflight_browser):
    problems, report = preflight_run(tmp_path, preflight_browser, GOOD_MAIN_JS)
    assert not problems, problems
    assert report['input']['status'] == 'passed'
    assert report['preflight']['frame']['source'] == 'browser RAF'
    assert report['preflight']['frame']['status'] == 'not_evaluated'
    assert 'does not validate the game clock' in report['preflight']['frame']['limitation']


@pytest.mark.slow
@pytest.mark.parametrize(
    "name,main_js,expected",
    [
        ("throwing", THROWING_MAIN_JS, 'deliberate behavior failure'),
        ("blank", BLANK_MAIN_JS, 'expose window.__scene'),
        ("deaf", DEAF_MAIN_JS, 'turn block: expected gameplay state not observed'),
    ],
)
def test_checker_fails_a_broken_prototype(tmp_path, capsys, name, main_js, expected) -> None:
    """The failing mutations: each of these must be caught, not passed."""
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_{name}" / name
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(runs_dir, name, main_js)
    try:
        assert _run_checker(runs_dir, name) == 1, f"{name} should have failed the check"
        assert expected in capsys.readouterr().err
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
def test_checker_flags_a_right_click_the_frame_loop_reverts(capsys) -> None:
    """Regression: a run's right-click looked dead but passed every check.

    The handler fired and wrote its log row, so the "HUD changed" check passed,
    the canvas drew, and nothing complained -- while the frame loop rebuilt the
    cleared state one frame later. The checker must notice that only a log row
    moved.
    """
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_revert" / "revert"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(
        runs_dir,
        "revert",
        REVERTING_RIGHT_CLICK_MAIN_JS,
        controls=["Right click: cancel selection"],
    )
    try:
        assert _run_checker(runs_dir, "revert") == 1
        assert 'cancel: expected gameplay state not observed after persist_ms' in capsys.readouterr().err
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
def test_checker_accepts_a_right_click_that_sticks() -> None:
    """The same prototype with a working latch must pass, or the check is useless."""
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    # Guard the string surgery that builds the fixture: a silently failed replace
    # would make this test pass for the wrong reason.
    assert "if (inside && !cancelled)" in PERSISTING_RIGHT_CLICK_MAIN_JS
    assert "cancelled = true;" in PERSISTING_RIGHT_CLICK_MAIN_JS

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_persist" / "persist"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(
        runs_dir,
        "persist",
        PERSISTING_RIGHT_CLICK_MAIN_JS,
        controls=["Right click: cancel selection"],
    )
    try:
        assert _run_checker(runs_dir, "persist") == 0
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
def test_checker_requires_the_framing_handle(tmp_path, capsys) -> None:
    """A run without window.__scene must fail rather than skip the framing check.

    Silently skipping would let the classic axis-sign mistake through: a scene
    built behind the camera still renders a plausible frame of empty background.
    """
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    # GOOD_MAIN_JS minus the handle: everything else about it is fine.
    without_handle = GOOD_MAIN_JS.replace("window.__scene = { scene, camera };", "")
    assert "window.__scene =" not in without_handle

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_nohandle" / "nohandle"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(runs_dir, "nohandle", without_handle)
    try:
        assert _run_checker(runs_dir, "nohandle") == 1
        assert 'expose window.__scene' in capsys.readouterr().err
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
def test_checker_passes_real_input_with_a_static_hud(tmp_path) -> None:
    """The passing fixture, so the failing mutations above mean something."""
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_good" / "good"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(runs_dir, "good", GOOD_MAIN_JS)
    try:
        assert _run_checker(runs_dir, "good") == 0
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
@pytest.mark.parametrize('scale_works', [False, True])
def test_each_signature_needs_its_own_successful_state_change(scale_works):
    """A working turn cannot mask a disconnected scale input with a weak assertion."""
    main_js = GOOD_MAIN_JS.replace('({turned: box.rotation.y > 1})',
                                   '({turned: box.rotation.y > 1, scale: box.scale.x})')
    if scale_works:
        main_js = main_js.replace('  const clock = new Clock();',
                                 "  window.addEventListener('keydown', (e) => { if (e.key === 's') box.scale.setScalar(2); });\n"
                                 '  const clock = new Clock();')
    name = f'signatures_{scale_works}'
    runs_dir = REPO_ROOT / 'forge/tests/.fixtures' / f'_checker_{os.getpid()}_{name}' / 'runs'
    _write_run(runs_dir, name, main_js, controls=['Enter: turn', 'S: scale'])
    card_path = runs_dir / name / 'step2.json'
    card = json.loads(card_path.read_text())
    card['input_checks'].append({'name': 'scale block', 'actions': [{'type': 'tap', 'key': 's'}],
                                 'expect': {'scale': {'$gte': 1}}})
    card['signature_actions'].append({
        'id': 'scale', 'brief_refs': ['/core_verb'], 'action': 'Scale the block',
        'feedback': 'The block grows', 'success_checks': ['scale block'],
        'boundary': {'skip_reason': 'No held or rejected scale state; success observes persistence.'},
    })
    card_path.write_text(json.dumps(card))
    shots = runs_dir.parent / 'evidence'
    try:
        result = check_step2.main(['--runs', str(runs_dir.relative_to(REPO_ROOT)), '--only', name,
                                   '--output', str(shots.relative_to(REPO_ROOT)), '--settle-ms', '150'])
        assert result == (0 if scale_works else 1)
        report = json.loads((shots / f'{name}.json').read_text())
        assert report['input']['status'] == 'passed'  # Both literal predicates were satisfied.
        assert len(report['input']['observations']) == 4
        assert report['signature']['status'] == ('declared_checks_passed' if scale_works else 'failed')
        assert report['functional']['status'] == ('passed' if scale_works else 'failed')
        if not scale_works:
            assert any('scale:' in error for error in report['signature']['errors'])
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


# A prototype that boots correctly but SLOWLY -- slower than the old fixed settle
# window. Nothing about it is broken; it just does not finish before the checker used
# to start asserting. This is the flake reduced to a fixture: the real cause was 22
# pages contending for one CPU under software rendering, which the delay simulates
# deterministically.
SLOW_BOOT_MAIN_JS = GOOD_MAIN_JS.replace(
    "export async function start() {",
    """export async function start() {
  // Longer than the 900ms default settle. A correct prototype, merely late.
  await new Promise((resolve) => setTimeout(resolve, 2200));""",
)


@pytest.mark.slow
def test_checker_waits_for_a_slow_boot_instead_of_failing_it() -> None:
    """The regression test for the flake.

    `wait_until="load"` fires when the shell's module script BEGINS -- the dynamic
    `import('./main.js')` and the whole scene build happen after it. With only a fixed
    settle_ms of slack, a run that booted late was reported as "no <canvas> element"
    plus "no window.__scene handle", and which run lost the race varied per pass.

    A flaky gate is worse than a slow one: it teaches everyone to re-run until green,
    which is how a real failure gets waved through. So the checker must now wait for
    the boot to finish, and this asserts it does -- with a settle window far too short
    to have covered the delay.
    """
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_slow" / "slow"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(runs_dir, "slow", SLOW_BOOT_MAIN_JS)
    try:
        exit_code = check_step2.main(
            [
                "--runs",
                str(runs_dir.relative_to(REPO_ROOT)),
                "--only",
                "slow",
                "--output",
                "",
                # Deliberately far shorter than the fixture's 2200ms boot: passing can
                # only happen by waiting for the boot, never by out-sleeping it.
                "--settle-ms",
                "150",
            ]
        )
        assert exit_code == 0, "a correct-but-slow prototype must pass, not flake"
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)


@pytest.mark.slow
def test_a_prototype_that_never_boots_is_still_reported(capsys) -> None:
    """Waiting must not become waiting forever.

    The complement of the test above: tolerating a slow boot is only safe if a boot
    that never completes is still a failure, and is reported as such rather than as a
    bare "no <canvas>".
    """
    if not TEMPLATE.is_file():
        pytest.skip("the index template is absent")

    never = """
export async function start() {
  // Never renders, never sets __scene: the hang the timeout exists to catch.
  await new Promise(() => {});
}
"""
    runs_dir = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_checker_fixtures_{os.getpid()}_hang" / "hang"
    runs_dir.mkdir(parents=True, exist_ok=True)
    _write_run(runs_dir, "hang", never)
    try:
        exit_code = check_step2.main(
            [
                "--runs",
                str(runs_dir.relative_to(REPO_ROOT)),
                "--only",
                "hang",
                "--output",
                "",
                # The idle sample duration is independent of the bounded boot timeout.
                "--settle-ms",
                "200",
            ]
        )
        assert exit_code == 1, "a prototype that never boots must fail"
        assert 'prototype never finished starting' in capsys.readouterr().err
    finally:
        import shutil

        shutil.rmtree(runs_dir.parent, ignore_errors=True)
