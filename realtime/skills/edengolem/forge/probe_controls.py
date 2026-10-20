"""Measure a behavior prototype's input mapping and camera smoothness (fail loud).

Optional diagnostic, not a gate. Each mode avoids a measurement mistake that reads
like a prototype defect:

  1. `dirs` holds keys, because integrated movement produces a zero delta on a tap.
  2. `camera` samples actor and camera inside ONE evaluation, so a moving follow
     camera cannot be mistaken for actor motion.
  3. `heading` reads heading rather than position, because a continuously advancing
     actor travels without input and legitimately refuses a reversal.

Each mode needs the observations it measures: `dirs` a recognized actor position,
`heading` `__scene.snake` plus `board.cellToWorldPoint`, `camera` `__scene.camera`.

Contract: --help; non-zero exit + printed reason on failure; no network; starts
its own server on a free port; writes nothing.

Usage:
    python forge/probe_controls.py dirs <run> --hold KeyA:left,KeyD:right
    python forge/probe_controls.py heading <run> --press ArrowLeft:left
    python forge/probe_controls.py camera <run> --keys ArrowLeft,ArrowUp,ArrowRight
    python forge/probe_controls.py dirs <run> --runs runs/step2 --hold KeyA:left
"""

import argparse
import math
import statistics
import sys
import threading
from functools import partial
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "forge"))

from check_step1 import SOFTWARE_GL_ARGS, find_chromium, free_port  # noqa: E402
from _shared.runtime import browser_args
from serve_step import ReusableServer, Step1Handler  # noqa: E402

# Both sample points are projected inside one evaluation, and every plausible
# carrier of a world position is tried, so this works across runs that name their
# actor differently.
_ACTOR_NDC = """() => {
  const d = window.__scene;
  if (!d || !d.camera) return null;
  const candidates = [
    d.actor && d.actor.group && d.actor.group.position,
    d.actor && d.actor.position,
    d.player && d.player.position,
    d.fighter && d.fighter.position,
    d.headMesh && d.headMesh.position,
    d.plane && d.plane.position,
  ];
  const pos = candidates.find((p) => p && typeof p.x === 'number');
  if (!pos) return null;
  d.camera.updateMatrixWorld(true);
  const v = pos.clone().project(d.camera);
  return { x: v.x, y: v.y, world: [pos.x, pos.y, pos.z] };
}"""

# Heading as the player sees it: project the actor's cell and the cell one step
# along its heading, both against the same camera matrix, and take the difference.
_HEADING_NDC = """() => {
  const d = window.__scene;
  const snake = d && d.snake;
  if (!snake || !d.board || !d.board.cellToWorldPoint) return null;
  const dir = snake.direction
    || (snake.getDirection && snake.getDirection())
    || snake.currentDirection;
  const head = snake.head || (snake.segments && snake.segments[0]);
  if (!dir || !head) return null;
  const a = d.board.cellToWorldPoint(head, 0);
  const b = d.board.cellToWorldPoint(
    { right: head.right + dir.right, forward: head.forward + dir.forward }, 0);
  d.camera.updateMatrixWorld(true);
  const pa = a.clone().project(d.camera);
  const pb = b.clone().project(d.camera);
  return { dx: pb.x - pa.x, dy: pb.y - pa.y, cell: dir };
}"""

# Position, orientation and a timestamp together. The timestamp matters: a raw
# per-sample delta is confounded by how long the sample round-trip took, so a slow
# evaluate looks exactly like a camera lurch. Speed (delta / elapsed) is the metric
# that actually isolates camera motion. Orientation is sampled too because a camera
# that ROTATES under the player is the most nausea-inducing motion there is, and it
# does not show up in a position delta at all.
_CAMERA_POSE = """() => {
  const c = window.__scene && window.__scene.camera;
  if (!c) return null;
  return {
    p: [c.position.x, c.position.y, c.position.z],
    q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w],
    t: performance.now(),
  };
}"""

_EPS = 0.004


def classify(dx, dy):
    """Screen-space delta -> a direction name, dominant axis wins."""
    if abs(dx) >= abs(dy):
        if dx > _EPS:
            return "right"
        if dx < -_EPS:
            return "left"
    else:
        if dy > _EPS:
            return "up"
        if dy < -_EPS:
            return "down"
    return "none"


def serve(runs_rel="runs/step2", project_root=REPO_ROOT):
    runs_dir = (project_root / runs_rel).resolve()
    port = free_port()
    server = ReusableServer(
        ("127.0.0.1", port),
        partial(Step1Handler, runs_dir=runs_dir, runs_rel=runs_rel, project_root=project_root),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{port}/{runs_rel}"


def parse_pairs(raw):
    pairs = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise SystemExit(f"error: expected KEY:direction, got {chunk!r}")
        key, want = chunk.split(":", 1)
        pairs.append((key.strip(), want.strip()))
    return pairs


def cmd_dirs(page, base, run, args):
    """Hold each key and check the actor's screen-space movement direction.

    Needs a camera that can SEE the actor. In a first-person run the camera sits at
    the actor's eye, so projecting the actor through it is degenerate and yields
    NaN -- which prints as "moved none" and reads exactly like a dead control. Use
    `heading` mode for those, or measure the camera's own forward direction.
    """
    problems = []
    for key, want in parse_pairs(args.hold):
        # Reload between keys so a prior press cannot bias the start pose.
        page.goto(f"{base}/{run}/", wait_until="load", timeout=20000)
        page.wait_for_timeout(args.settle_ms)
        before = page.evaluate(_ACTOR_NDC)
        if before is None:
            problems.append(f"{run}: no readable actor position on window.__scene")
            break

        page.keyboard.down(key)
        page.wait_for_timeout(args.hold_ms)
        page.keyboard.up(key)
        page.wait_for_timeout(120)
        after = page.evaluate(_ACTOR_NDC)

        dx, dy = after["x"] - before["x"], after["y"] - before["y"]
        # A degenerate projection (first-person camera sitting on the actor) yields
        # NaN, which classify() would report as "none" -- indistinguishable from a
        # dead control. Say what actually happened instead.
        if not (math.isfinite(dx) and math.isfinite(dy)):
            print(f"  hold {key:11s} want {want:5s}  projection is degenerate (NaN)")
            problems.append(
                f"{run}: the actor projects to NaN through this camera, so screen-space "
                "movement cannot be measured. This is a first-person view; use "
                "`heading` mode or probe the camera's own forward direction."
            )
            break
        got = classify(dx, dy)
        ok = got == want
        print(
            f"  hold {key:11s} want {want:5s}  dx={dx:+.4f} dy={dy:+.4f}  "
            f"got {got:5s}  {'ok' if ok else 'MISMATCH'}"
        )
        if not ok:
            problems.append(f"{run}: holding {key} should move {want}, moved {got}")
    return problems


def cmd_heading(page, base, run, args):
    """Press each key and check the resulting HEADING on screen.

    One fresh page per direction: from a fixed spawn heading, the opposite
    direction is a 180-degree reverse, which a snake correctly refuses.
    """
    problems = []
    for key, want in parse_pairs(args.press):
        page.goto(f"{base}/{run}/", wait_until="load", timeout=20000)
        page.wait_for_timeout(args.settle_ms)
        spawn = page.evaluate(_HEADING_NDC)
        if spawn is None:
            problems.append(f"{run}: no readable heading on window.__scene")
            break

        # If the request is the reverse of the spawn heading, reach it legally via
        # one perpendicular turn first -- otherwise the refusal looks like a bug.
        if classify(spawn["dx"], spawn["dy"]) == opposite(want):
            for pivot in ("ArrowLeft", "ArrowRight"):
                page.keyboard.press(pivot)
                page.wait_for_timeout(args.tick_ms)
                if classify(*heading_of(page)) not in (want, opposite(want)):
                    break

        page.keyboard.press(key)
        page.wait_for_timeout(args.tick_ms)
        after = page.evaluate(_HEADING_NDC)
        got = classify(after["dx"], after["dy"])
        ok = got == want
        print(
            f"  press {key:11s} want {want:5s}  heading cell={after['cell']} "
            f"dx={after['dx']:+.4f} dy={after['dy']:+.4f}  got {got:5s}  "
            f"{'ok' if ok else 'MISMATCH'}"
        )
        if not ok:
            problems.append(f"{run}: pressing {key} should head {want}, headed {got}")
    return problems


def opposite(name):
    return {"left": "right", "right": "left", "up": "down", "down": "up"}.get(name, name)


def heading_of(page):
    h = page.evaluate(_HEADING_NDC)
    return (h["dx"], h["dy"]) if h else (0.0, 0.0)


def cmd_camera(page, base, run, args):
    """Sample camera motion per frame while pressing keys; report the worst jump.

    A camera that chases a discontinuous target lurches on every direction
    change. The max per-frame delta is the number that exposes it -- the mean
    stays low because the lurch is brief, which is exactly why it is easy to miss.
    """
    problems = []
    page.goto(f"{base}/{run}/", wait_until="load", timeout=20000)
    page.wait_for_timeout(args.settle_ms)

    keys = [k.strip() for k in args.keys.split(",") if k.strip()]
    speeds = []
    turn_rates = []
    previous = page.evaluate(_CAMERA_POSE)
    if previous is None:
        return [f"{run}: window.__scene.camera is not exposed"]

    for index in range(args.frames):
        if keys and index % args.every == 0:
            page.keyboard.press(keys[(index // args.every) % len(keys)])
        page.wait_for_timeout(16)
        current = page.evaluate(_CAMERA_POSE)

        elapsed = (current["t"] - previous["t"]) / 1000.0
        if elapsed > 1e-6:
            distance = sum(
                (current["p"][i] - previous["p"][i]) ** 2 for i in range(3)
            ) ** 0.5
            speeds.append(distance / elapsed)
            # |dot| of successive quaternions: 1.0 means no rotation at all.
            dot = abs(sum(current["q"][i] * previous["q"][i] for i in range(4)))
            turn_rates.append(min(1.0, dot))
        previous = current

    if not speeds:
        return [f"{run}: camera produced no readable samples"]
    worst = max(speeds)
    mean = statistics.fmean(speeds)
    least_aligned = min(turn_rates)
    print(f"  camera speed: max={worst:.2f} u/s  mean={mean:.2f} u/s  over {len(speeds)} samples")
    if mean > 1e-9:
        print(f"  spike ratio max/mean = {worst / mean:.1f}x")
    print(
        f"  orientation: min |dot| between samples = {least_aligned:.5f}"
        f"{'  (camera never rotates)' if least_aligned > 0.99999 else '  (camera rotates)'}"
    )
    if args.max_speed is not None and worst > args.max_speed:
        problems.append(
            f"{run}: camera reached {worst:.2f} u/s, over the {args.max_speed} u/s "
            "limit (a lurch on direction change)"
        )
    return problems


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure a behavior prototype's input mapping and camera smoothness."
    )
    parser.add_argument("--project-root", type=Path, default=REPO_ROOT,
                        help="project root for runs, assets and npm dependencies (default: skill repository)")
    parser.add_argument("mode", choices=("dirs", "heading", "camera"))
    parser.add_argument("run", help="run folder name inside --runs")
    parser.add_argument(
        "--runs",
        default="runs/step2",
        help="directory of run folders, relative to --project-root (default: runs/step2)",
    )
    parser.add_argument("--hold", default="", help="dirs: KEY:direction pairs, comma separated")
    parser.add_argument("--press", default="", help="heading: KEY:direction pairs")
    parser.add_argument("--keys", default="", help="camera: keys to cycle while sampling")
    parser.add_argument("--frames", type=int, default=120, help="camera: frames to sample")
    parser.add_argument("--every", type=int, default=20, help="camera: press a key every N frames")
    parser.add_argument(
        "--max-speed", type=float, default=None, help="camera: fail above this u/s"
    )
    parser.add_argument("--hold-ms", type=int, default=800, help="dirs: how long to hold")
    parser.add_argument("--tick-ms", type=int, default=600, help="heading: wait after a press")
    parser.add_argument("--settle-ms", type=int, default=800, help="wait after load")
    parser.add_argument('--hardware', action='store_true', help='omit forced SwiftShader; inspect renderer separately with behavior preflight')
    args = parser.parse_args(argv)

    if args.mode == "dirs" and not args.hold:
        print("error: dirs mode needs --hold KEY:direction,...", file=sys.stderr)
        return 2
    if args.mode == "heading" and not args.press:
        print("error: heading mode needs --press KEY:direction,...", file=sys.stderr)
        return 2
    if args.frames < 1:
        print("error: --frames must be at least 1", file=sys.stderr)
        return 2
    if args.every < 1:
        print("error: --every must be at least 1", file=sys.stderr)
        return 2

    project_root = args.project_root.resolve()
    runs_dir = (project_root / args.runs).resolve()
    if not runs_dir.is_relative_to(project_root):
        print(f"error: --runs must stay inside the project root: {args.runs}", file=sys.stderr)
        return 2
    runs_rel = runs_dir.relative_to(project_root).as_posix()
    run_dir = (runs_dir / args.run).resolve()
    if run_dir.parent != runs_dir or not (run_dir / "index.html").is_file():
        print(f"error: no such run: {args.run}", file=sys.stderr)
        return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("error: playwright is not installed in this interpreter", file=sys.stderr)
        return 2

    chromium = find_chromium()
    if not chromium or not Path(chromium).exists():
        print("error: no Chromium found; set GBDATA_CHROMIUM", file=sys.stderr)
        return 2

    server, base = serve(runs_rel, project_root)
    problems = []
    print(f"{args.mode}: {args.run}")
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True, args=browser_args(args.hardware), executable_path=chromium
            )
            page = browser.new_page(viewport={"width": 900, "height": 560})
            page.on("pageerror", lambda e: problems.append(f"uncaught: {e}"))
            try:
                handler = {"dirs": cmd_dirs, "heading": cmd_heading, "camera": cmd_camera}
                problems.extend(handler[args.mode](page, base, args.run, args))
            finally:
                page.close()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if problems:
        print("\nFAIL", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
