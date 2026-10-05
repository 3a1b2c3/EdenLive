"""Tests for forge/probe_controls.py (the input-mapping and camera-motion probe).

The load-bearing property is that the probe FAILS on a mirrored mapping. A probe
that passes everything is worse than none -- and this one exists precisely because
five hand-written throwaway versions produced three false results in a row.

The browser tests build their own synthetic run rather than probing a reference
template. That keeps them honest in two ways: the fixture states its mapping
explicitly, so "left really is left" is a property of the test rather than of some
prototype's current state, and the suite does not quietly start passing or failing
when the reference set is edited.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "forge"))

import probe_controls  # noqa: E402

FIXTURES = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_probe_test_fixtures_{os.getpid()}"
TEMPLATE = REPO_ROOT / "assets" / "template" / "index.html"

# A third-person run with a known-correct mapping: A moves screen-left, D moves
# screen-right, and the camera sits back far enough to see the actor. The camera
# also drifts, so `camera` mode has motion to measure.
SYNTHETIC_MAIN_JS = """
import {
  BoxGeometry, Clock, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';

const SPEED = 6;

export async function start() {
  const container = document.getElementById('app');
  const hud = document.getElementById('hud');

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth || 900, container.clientHeight || 560, false);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 200);
  scene.add(new DirectionalLight(0xffffff, 1.2));

  const actor = new Mesh(
    new BoxGeometry(1, 2, 1),
    new MeshStandardMaterial({ color: 0x88bbff })
  );
  scene.add(actor);

  // Held-key state. `dirs` mode holds a key, so a tap-only reading would be zero.
  const held = new Set();
  window.addEventListener('keydown', (e) => held.add(e.code));
  window.addEventListener('keyup', (e) => held.delete(e.code));

  // A grid actor for `heading` mode: the probe reads snake.direction and converts
  // a cell to world through board.cellToWorldPoint.
  const snake = { direction: { right: 0, forward: 1 }, segments: [{ right: 0, forward: 0 }] };
  const board = {
    cellToWorldPoint: (cell) => ({
      x: cell.right, y: 0, z: -cell.forward,
      clone() { return { ...this, clone: this.clone, project: this.project }; },
      project(cam) {
        const v = new camera.position.constructor(this.x, this.y, this.z);
        return v.project(cam);
      },
    }),
  };

  window.__scene = { scene, camera, actor, snake, board };

  const clock = new Clock();
  let bob = 0;
  function frame() {
    const delta = Math.min(clock.getDelta(), 1 / 20);
    let dx = 0;
    if (held.has('KeyA') || held.has('ArrowLeft')) dx -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) dx += 1;
    if (held.has('ArrowUp')) snake.direction = { right: 0, forward: 1 };
    if (held.has('ArrowDown')) snake.direction = { right: 0, forward: -1 };
    actor.position.x += dx * SPEED * delta;

    // Camera behind and above, following the actor at HALF its rate and looking
    // straight ahead rather than at it. Both details matter: a camera that tracks
    // the actor exactly, or aims at it, keeps the actor pinned to screen centre so
    // the screen-space delta is zero -- which reads as a dead control.
    //
    // The vertical bob gives `camera` mode motion to measure without input. That
    // matters because camera mode PRESSES keys rather than holding them, and this
    // fixture only moves while a key is held -- so a bob-free camera would sit at
    // 0.00 u/s and a speed-ceiling assertion could never trip. The amplitude is
    // small enough that screen-Y noise stays well under the screen-X signal that
    // `dirs` mode measures.
    bob += delta;
    camera.position.set(actor.position.x * 0.5, 4 + Math.sin(bob) * 0.15, 12);
    camera.lookAt(actor.position.x * 0.5, 0, 0);
    hud.textContent = `x ${actor.position.x.toFixed(2)}\\nheld ${held.size}`;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
"""


def run_probe(*args) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "forge" / "probe_controls.py"), *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def make_run(name: str = "synthetic") -> Path:
    """Write a self-contained run under a scratch runs directory."""
    run = FIXTURES / name
    run.mkdir(parents=True, exist_ok=True)
    run.joinpath("index.html").write_text(
        TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    run.joinpath("main.js").write_text(SYNTHETIC_MAIN_JS, encoding="utf-8")
    run.joinpath("step1.json").write_text(
        '{"brief": "synthetic", "controls": ["A/D: move"]}', encoding="utf-8"
    )
    return run


@pytest.fixture(autouse=True)
def clean_fixtures():
    yield
    shutil.rmtree(FIXTURES, ignore_errors=True)


RUNS_ARG = ("--runs", str(FIXTURES.relative_to(REPO_ROOT)))


# --- pure logic, no browser -------------------------------------------------


def test_classify_picks_the_dominant_axis() -> None:
    # A diagonal must resolve to its larger component, not to both.
    assert probe_controls.classify(0.5, 0.1) == "right"
    assert probe_controls.classify(-0.5, 0.1) == "left"
    assert probe_controls.classify(0.1, 0.5) == "up"
    assert probe_controls.classify(0.1, -0.5) == "down"


def test_classify_treats_sub_epsilon_motion_as_none() -> None:
    # This is what makes "the control is dead" distinguishable from "it moved a
    # little": floating-point noise must not read as a direction.
    assert probe_controls.classify(0.0, 0.0) == "none"
    assert probe_controls.classify(0.001, 0.0005) == "none"


def test_opposite_covers_all_four_directions() -> None:
    for a, b in (("left", "right"), ("up", "down")):
        assert probe_controls.opposite(a) == b
        assert probe_controls.opposite(b) == a


def test_parse_pairs_rejects_a_malformed_spec() -> None:
    assert probe_controls.parse_pairs("KeyA:left,KeyD:right") == [
        ("KeyA", "left"),
        ("KeyD", "right"),
    ]
    with pytest.raises(SystemExit):
        probe_controls.parse_pairs("KeyA")


# --- CLI contract ----------------------------------------------------------


def test_help_exits_zero() -> None:
    assert run_probe("--help").returncode == 0


def test_unknown_run_is_an_error() -> None:
    result = run_probe("dirs", "no-such-run", "--hold", "KeyA:left")
    assert result.returncode == 2
    assert "no such run" in result.stderr


def test_dirs_without_hold_is_an_error() -> None:
    make_run()
    result = run_probe("dirs", "synthetic", *RUNS_ARG)
    assert result.returncode == 2
    assert "--hold" in result.stderr


def test_runs_must_stay_inside_the_project_root() -> None:
    result = run_probe("dirs", "x", "--runs", "../../etc", "--hold", "KeyA:left")
    assert result.returncode == 2
    assert "inside the project root" in result.stderr


# --- browser behaviour: the failing mutation is the point ------------------


@pytest.mark.slow
def test_probe_fails_a_mirrored_expectation() -> None:
    """Asserting the wrong direction must fail, or the probe proves nothing."""
    make_run()
    result = run_probe("dirs", "synthetic", *RUNS_ARG, "--hold", "KeyA:right")
    assert result.returncode == 1, result.stdout
    assert "should move right, moved left" in result.stderr


@pytest.mark.slow
def test_probe_passes_the_correct_expectation() -> None:
    """The fixture's mapping is A=left, D=right, stated in its own source."""
    make_run()
    result = run_probe("dirs", "synthetic", *RUNS_ARG, "--hold", "KeyA:left,KeyD:right")
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.slow
def test_camera_mode_reports_speed_and_rotation() -> None:
    """Camera mode must report time-normalised speed, not raw per-sample delta.

    A raw delta is confounded by how long the evaluate round-trip took, so a slow
    sample looks identical to a camera lurch -- that confusion cost a wrong
    conclusion during the review this script came out of.
    """
    make_run()
    result = run_probe(
        "camera", "synthetic", *RUNS_ARG, "--keys", "KeyA,KeyD", "--frames", "30"
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "u/s" in result.stdout
    assert "orientation" in result.stdout


@pytest.mark.slow
def test_camera_mode_enforces_a_speed_ceiling() -> None:
    """An absurdly low ceiling must fail, proving the threshold is wired up."""
    make_run()
    result = run_probe(
        "camera", "synthetic", *RUNS_ARG, "--keys", "KeyA",
        "--frames", "30", "--max-speed", "0.001",
    )
    assert result.returncode == 1, result.stdout
    assert "over the 0.001 u/s limit" in result.stderr


@pytest.mark.slow
def test_dirs_reports_a_degenerate_projection_instead_of_a_dead_control() -> None:
    """A first-person camera sits on the actor, so the projection is NaN.

    classify() would call that "none", which reads exactly like a control that does
    nothing -- a false accusation against a working prototype. The probe has to name
    the real cause.
    """
    run = make_run("firstperson")
    # Same fixture, but the camera rides the actor: the projection degenerates.
    anchor = (
        "camera.position.set(actor.position.x * 0.5, 4 + Math.sin(bob) * 0.15, 12);\n"
        "    camera.lookAt(actor.position.x * 0.5, 0, 0);"
    )
    assert anchor in SYNTHETIC_MAIN_JS, "the fixture's camera lines moved; update this anchor"
    run.joinpath("main.js").write_text(
        SYNTHETIC_MAIN_JS.replace(anchor, "camera.position.copy(actor.position);"),
        encoding="utf-8",
    )
    result = run_probe("dirs", "firstperson", *RUNS_ARG, "--hold", "KeyA:left")
    assert result.returncode == 1, result.stdout
    assert "degenerate" in result.stdout or "NaN" in result.stderr
