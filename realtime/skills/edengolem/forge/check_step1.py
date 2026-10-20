"""Check a complete static scene in Chromium.

Fails on console/runtime/network errors, missing or unframed scene objects,
a WebGL play canvas whose CSS box does not match its container, failed framing
or missing scene-manifest coverage. Bounds intersecting the frustum do not prove visible
pixels, readable presentation or usable controls; inspect screenshots and play.
SwiftShader checks function, not target-hardware performance.

Use --project-root for standalone output; --runs and --output resolve under it.
Use --only to select explicit artifacts.
The scene stage deliberately does not require successful gameplay input; behavior
and acceptance checks own that proof.
"""

import argparse
import contextlib
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "forge"))

from serve_step import ReusableServer, Step1Handler, discover_runs  # noqa: E402
from functools import partial  # noqa: E402
from _shared.browser_input import check_inputs
from _shared.paths import resolve_inside
from _shared.runtime import SOFTWARE_GL_ARGS, browser_args, install_runtime_probe, runtime_report
from _shared.image_review import preflight as image_preflight
from _shared.attempts import stage_snapshot, record_stage
from _shared.catalog_eval import (
    catalog_skip_problems, environment_catalog_paths, runtime_imported_assets,
    scene_custom_problems,
)

# Ignorable console noise. Kept tiny and explicit: anything not listed here that
# reaches console.error fails the run, which is the point of the check.
IGNORED_CONSOLE = (
    "Download the React DevTools",
    "WebGL: INVALID_OPERATION",  # benign during context teardown
)

def find_chromium():
    """Playwright's browser cache first, then PATH (the reference detection order).

    No machine-specific location is assumed: set GBDATA_CHROMIUM for an explicit
    executable, or PLAYWRIGHT_BROWSERS_PATH when the cache is not in its per-user
    default. Returning None lets callers report the missing dependency.
    """
    configured = os.environ.get("GBDATA_CHROMIUM")
    if configured:
        return configured

    shared = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    caches = ([Path(shared)] if shared else []) + [Path.home() / ".cache" / "ms-playwright"]
    patterns = (
        "chromium-*/chrome-linux64/chrome",
        "chromium_headless_shell-*/chrome-headless-shell-linux64/headless_shell",
    )
    for pattern in patterns:
        for cache in caches:
            matches = sorted(cache.glob(pattern))
            if matches:
                return str(matches[-1])

    import shutil

    return shutil.which("chromium") or shutil.which("chromium-browser")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def serving(runs_dir: Path, runs_rel: str, project_root=REPO_ROOT):
    port = free_port()
    handler = partial(Step1Handler, runs_dir=runs_dir, runs_rel=runs_rel, project_root=project_root)
    server = ReusableServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()


def wait_for_boot(page, timeout_ms):
    """Wait for an observable ready surface or a visible fatal error."""
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    try:
        page.wait_for_function("""() => {
          const fatal = document.querySelector('#fatal');
          return (fatal && getComputedStyle(fatal).display !== 'none' && fatal.textContent.trim()) ||
            Boolean(window.__scene && (document.querySelector('canvas') || window.__scene.root));
        }""", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        return {'ok': False, 'reason': 'prototype never finished starting: expose window.__scene with scene/camera or a DOM root'}
    return canvas_report(page)


def canvas_report(page):
    """Check the play surface, including fatal errors and WebGL canvas/container fit.

    A WebGL canvas used as the play surface must display at the CSS size of `#app`
    (or its parent). The drawing buffer may scale with devicePixelRatio; the CSS
    box must not. DOM/canvas2d `__scene.root` surfaces skip the container-fit
    rule. Framing does not require the player to be centered.
    """
    return page.evaluate("""() => {
      const fatal = document.querySelector('#fatal');
      if (fatal && getComputedStyle(fatal).display !== 'none' && fatal.textContent.trim())
        return {ok:false, reason:`page reported fatal: ${fatal.textContent.slice(0,400)}`};
      const namedRoot = window.__scene?.root;
      const canvas = document.querySelector('#app canvas') || document.querySelector('canvas');
      const surface = namedRoot || canvas;
      if (!(surface instanceof Element)) return {ok:false, reason:'no scene surface'};
      const r = surface.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || (surface instanceof HTMLCanvasElement && (!surface.width || !surface.height)))
        return {ok:false, reason:'scene surface has zero size'};
      const report = {
        ok: true, width: r.width, height: r.height,
        bufferWidth: surface instanceof HTMLCanvasElement ? surface.width : null,
        bufferHeight: surface instanceof HTMLCanvasElement ? surface.height : null,
        devicePixelRatio: window.devicePixelRatio,
      };
      // Named DOM/canvas2d roots are the play surface; do not demand they fill #app.
      if (namedRoot instanceof Element && namedRoot !== canvas) return report;
      if (!(canvas instanceof HTMLCanvasElement) || !window.__scene?.scene || !window.__scene?.camera)
        return report;
      const container = document.getElementById('app') || canvas.parentElement;
      if (!(container instanceof Element))
        return {ok:false, reason:'WebGL play canvas has no #app or parent container'};
      const box = container.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0)
        return {ok:false, reason:'WebGL play canvas container has zero size'};
      const dx = Math.abs(r.width - box.width);
      const dy = Math.abs(r.height - box.height);
      if (dx > 1.5 || dy > 1.5)
        return {ok:false, reason:`WebGL play canvas CSS size ${r.width.toFixed(1)}x${r.height.toFixed(1)} does not match container ${box.width.toFixed(1)}x${box.height.toFixed(1)}`};
      report.containerWidth = box.width;
      report.containerHeight = box.height;
      return report;
    }""")


def framing_report(page):
    return page.evaluate("""async () => {
      const debug = window.__scene;
      if (debug?.scene && debug?.camera) {
        const {Frustum, Matrix4} = await import('/vendor/three.module.js');
        const {scene, camera} = debug;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        let meshes=0, onScreen=0;
        scene.traverseVisible(node => {
          if (!node.isMesh && !node.isPoints && !node.isLine) return;
          meshes++; if (frustum.intersectsObject(node)) onScreen++;
        });
        return {skipped:false, meshes, onScreen, surface:'three'};
      }
      const root = debug?.root;
      if (!(root instanceof Element)) return {skipped:true};
      const r=root.getBoundingClientRect();
      return {skipped:false, meshes:1, surface:'dom-or-canvas2d',
        onScreen:Number(r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight)};
    }""")


def static_sample(page):
    """A short idle sample detects accidental motion; images still need review."""
    return page.evaluate("""() => {
      const d=window.__scene, nodes=[];
      d?.scene?.traverse(n => nodes.push([n.uuid,n.visible,n.position.toArray(),n.quaternion.toArray(),n.scale.toArray()]));
      if (d?.camera) nodes.push(['camera',d.camera.position.toArray(),d.camera.quaternion.toArray(),d.camera.projectionMatrix.toArray()]);
      const root=d?.root;
      const canvases=root instanceof HTMLCanvasElement ? [root] : [...(root?.querySelectorAll('canvas') || [])];
      return {nodes, dom:root?.outerHTML || '',
        canvases:canvases.map(canvas => canvas.toDataURL()),
        animations:document.getAnimations().filter(a => a.playState === 'running').length};
    }""")


def hud_text(page):
    return page.evaluate(
        "() => (document.getElementById('hud')?.textContent ?? '').trim()"
    )


def frame_observation(page):
    """Validate exposed values without requiring a game tick before its first input.

    An idle or absent clock is unevaluated, not a startup failure. Declared input
    checks must establish clock progression when timing affects the mechanic.
    """
    return page.evaluate(
        """() => {
          const observed = window.__gameTest?.read?.() ?? {};
          if (!('frame' in observed)) {
            const samples = window.__runtimeProbe?.read?.() ?? [];
            const rawDt = samples[0];
            return {ok: true, status: 'not_evaluated', source: 'browser RAF',
              rawDt: Number.isFinite(rawDt) && rawDt >= 0 ? rawDt : null,
              limitation: 'No game frame exposed; passive RAF does not validate the game clock.'};
          }
          const frame = observed.frame;
          if (!frame || typeof frame !== 'object') {
            return {ok: false, status: 'failed', source: 'game snapshot', reason: 'exposed game frame must be an object'};
          }
          const id = frame.id;
          const rawDt = frame.rawDt;
          if (!Number.isInteger(id) || id < 0) {
            return {ok: false, status: 'failed', source: 'game snapshot', reason: `game frame id must be a nonnegative integer (got ${String(id)})`};
          }
          if (!Number.isFinite(rawDt) || rawDt < 0) {
            return {ok: false, status: 'failed', source: 'game snapshot', reason: `game frame rawDt must be finite and nonnegative (got ${String(rawDt)})`};
          }
          if (id === 0) {
            return {ok: true, status: 'not_evaluated', source: 'game snapshot', id, rawDt,
              limitation: 'Game clock has not advanced; verify relevant timing through declared input checks.'};
          }
          return {ok: true, status: 'passed', source: 'game snapshot', id, rawDt,
            limitation: 'Observed frame values only; clock progression requires gameplay evidence.'};
        }"""
    )


def scene_manifest(run, project_root):
    """Bind the intake inventory to concrete scene objects or DOM elements."""
    meta = run['meta']
    path = resolve_inside(project_root, Path(run['path']) / meta['scene_manifest'], 'scene manifest')
    brief_path = resolve_inside(project_root, Path(run['path']) / meta['brief'], 'brief')
    brief = json.loads(brief_path.read_text())
    manifest = json.loads(path.read_text())
    entries = manifest.get('elements') if isinstance(manifest, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ValueError('scene manifest needs nonempty elements')
    ids = [item.get('id') for item in entries if isinstance(item, dict)]
    expected = [item['id'] for item in brief['scene']['theme_elements']]
    if len(ids) != len(entries) or len(ids) != len(set(ids)) or set(expected) - set(ids):
        raise ValueError('scene manifest must uniquely cover every brief theme element')
    for item in entries:
        binding = item.get('binding', {})
        if (not isinstance(binding, dict) or len(binding) != 1 or
            not set(binding) <= {'object', 'selector'} or not all(isinstance(v,str) and v.strip() for v in binding.values())):
            raise ValueError(f"{item['id']}: binding needs one scene object name or DOM selector")
        if not item.get('asset') and not item.get('custom_reason', '').strip():
            raise ValueError(f"{item['id']}: name the reused asset or explain the custom primitive/DOM")
        if item.get('asset'):
            resolve_inside(project_root, item['asset'].lstrip('/'), 'scene asset').read_bytes()
    problems = scene_custom_problems(entries, brief, environment_catalog_paths(REPO_ROOT))
    if problems:
        raise ValueError('; '.join(problems))
    return entries


def binding_problems(page, entries):
    return page.evaluate("""entries => entries.flatMap(entry => {
      const b=entry.binding;
      if (b.object) return window.__scene?.scene?.getObjectByName(b.object) ? [] : [`${entry.id}: missing scene object ${b.object}`];
      try { return document.querySelector(b.selector) ? [] : [`${entry.id}: missing DOM element ${b.selector}`]; }
      catch { return [`${entry.id}: invalid selector`]; }
    })""", entries)


def behavior_problems(meta, brief):
    problems = []
    capabilities = meta.get('capabilities', [])
    coverage = meta.get('capability_checks', {})
    names = {c['name'] for c in meta.get('input_checks', [])}
    if not capabilities:
        problems.append('behavior must declare applicable capabilities')
    if set(coverage) != set(capabilities):
        problems.append('capability_checks must cover exactly the declared capabilities')
    for capability in capabilities:
        checks = coverage.get(capability)
        if not isinstance(checks, list) or not checks or any(c not in names for c in checks):
            problems.append(f'{capability}: link existing input checks for success and relevant boundaries')
    return problems


def check_run(browser, base_url, run, runs_rel, shots_dir, settle_ms, verbose,
              viewport=None, *, stage='scene', project_root=REPO_ROOT):
    """One browser session per artifact; static and input checks have distinct scopes."""
    from validate_run_meta import validate_meta
    from _shared.signature import signature_problems, signature_evidence_problems
    problems, observations, diagnostics = [], [], {}
    result = {'functional': {'status': 'not_evaluated', 'scope': stage},
              'input': {'status': 'not_evaluated', 'reason': 'static scene; behavior owns input proof', 'observations': observations},
              'signature': {'status': 'not_evaluated', 'errors': []},
              'preflight': {'status': 'not_evaluated'}, 'errors': problems}
    page = browser.new_page(
        viewport=viewport or {'width': 960, 'height': 600},
        device_scale_factor=2,
    )
    install_runtime_probe(page)
    page.on('console', lambda m: problems.append(f'console.error: {m.text}') if m.type == 'error' and not any(x in m.text for x in IGNORED_CONSOLE) else None)
    page.on('pageerror', lambda e: problems.append(f'uncaught: {e}'))
    page.on('response', lambda r: problems.append(f'HTTP {r.status}: {r.url}') if r.status >= 400 else None)
    page.on('requestfailed', lambda r: problems.append(f'request failed: {r.url} ({r.failure})'))
    try:
        errors = validate_meta(run['meta'])
        if errors:
            raise ValueError('; '.join(e.message for e in errors))
        entries = scene_manifest(run, project_root)
        brief = json.loads(resolve_inside(project_root, Path(run['path']) / run['meta']['brief'], 'brief').read_text())
        page.goto(f"{base_url}/{runs_rel}/{run['name']}/", wait_until='load', timeout=20000)
        boot = wait_for_boot(page, 20000)
        if not boot['ok']: raise ValueError(boot['reason'])
        framing = framing_report(page)
        if framing.get('skipped') or not framing.get('onScreen'):
            problems.append('scene has no framed drawable objects or visible DOM surface')
        problems.extend(binding_problems(page, entries))
        frame = frame_observation(page)
        if not frame['ok']: problems.append(frame['reason'])
        result['preflight'] = {'status':'failed' if problems else 'passed', 'framing':framing, 'frame':frame}
        if stage == 'scene':
            before = static_sample(page)
            page.wait_for_timeout(settle_ms)
            after = static_sample(page)
            if before != after or before['animations'] or after['animations']:
                problems.append('static scene changed during idle sampling; freeze actor poses, camera and UI animation')
            result['static'] = {'status':'failed' if problems else 'passed', 'sample_ms':settle_ms,
                                'limitation':'idle transform/DOM sample, not exhaustive animation analysis'}
        else:
            signature_errors = signature_problems(run['meta'], brief)
            problems.extend(signature_errors)
            result['signature'] = {'status': 'failed' if signature_errors else 'not_evaluated',
                                   'errors': signature_errors}
            problems.extend(behavior_problems(run['meta'], brief))
            problems.extend(catalog_skip_problems(
                run['meta'], runtime_imported_assets(project_root, run['path'])))
            if not problems:
                input_errors = check_inputs(page, run['meta'].get('input_checks'), observations)
                problems.extend(input_errors)
                result['input'] = {'status':'failed' if input_errors else 'passed', 'observations':observations}
                signature_errors = signature_evidence_problems(run['meta'], observations)
                problems.extend(signature_errors)
                result['signature'] = {
                    'status': 'failed' if input_errors or signature_errors else 'declared_checks_passed',
                    'errors': signature_errors,
                }
                frame = frame_observation(page)
                if not frame['ok']: problems.append(f"after input: {frame['reason']}")
            else:
                result['input']['reason'] = 'preflight or behavior contract failed; input not executed'
        diagnostics = runtime_report(page, run['meta'].get('capabilities', []))
        diagnostics['frame'] = frame
        if verbose:
            print(hud_text(page).split('\n')[0][:120], end=' ')
        if shots_dir is not None:
            shots_dir.mkdir(parents=True, exist_ok=True)
            diagnostics['imageReview'] = image_preflight(page, path=shots_dir / f"{run['name']}.png")
    except Exception as exc:
        problems.append(f'{type(exc).__name__}: {exc}')
    finally:
        result.update(runtime=diagnostics, diagnostics=diagnostics.get('diagnostics', {}))
        result['functional']['status'] = 'failed' if problems else 'passed'
        if shots_dir is not None:
            shots_dir.mkdir(parents=True, exist_ok=True)
            (shots_dir / f"{run['name']}.json").write_text(json.dumps(result, indent=2))
        page.close()
    return problems


def main(argv=None, *, stage='scene') -> int:
    parser = argparse.ArgumentParser(
        description=("Check complete static scenes in headless Chromium." if stage == 'scene'
                     else "Check capability-routed behavior through real browser inputs.")
    )
    parser.add_argument("--project-root", type=Path,
                        help="root containing runs, assets, npm and screenshots (default: skill repository)")
    parser.add_argument("--runs", default="runs/step1" if stage == "scene" else "runs/step2", help="runs directory")
    parser.add_argument(
        "--output",
        default="evidence/step1" if stage == "scene" else "evidence/step2",
        help="screenshot output directory, or '' to skip screenshots",
    )
    parser.add_argument("--only", default="", help="comma-separated run names to check")
    parser.add_argument(
        "--settle-ms", type=int, default=200, help="static idle sampling window in ms"
    )
    parser.add_argument("--verbose", action="store_true", help="print the first HUD line")
    parser.add_argument('--hardware', action='store_true', help='omit forced SwiftShader; inspect actual renderer')
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--height', type=int, default=600)
    parser.add_argument('--record-attempt', action='store_true',
                        help='append hash-bound attempt records for written reports')
    args = parser.parse_args(argv)
    if args.record_attempt and not args.output:
        parser.error('--record-attempt requires --output so the report can be hashed')

    project_root = (args.project_root or REPO_ROOT).resolve()
    try:
        if not 64 <= args.width <= 4096 or not 64 <= args.height <= 4096 or not 0 <= args.settle_ms <= 10000:
            raise ValueError('viewport must be 64..4096 and settle-ms 0..10000')
        runs_dir = resolve_inside(project_root, args.runs, "--runs")
        shots_dir = (project_root / args.output).resolve() if args.output else None
        if shots_dir is not None and args.project_root is not None:
            shots_dir = resolve_inside(project_root, shots_dir, '--output')
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    runs_rel = runs_dir.relative_to(project_root).as_posix()
    runs = discover_runs(runs_dir)
    if args.only:
        wanted = {name.strip() for name in args.only.split(",") if name.strip()}
        runs = [run for run in runs if run["name"] in wanted]
        missing = wanted - {run["name"] for run in runs}
        if missing:
            print(f"error: no such run(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    if not runs:
        print(f"error: no runs found under {args.runs}", file=sys.stderr)
        return 2

    if args.project_root is not None:
        try:
            for run in runs:
                resolve_inside(project_root, run["path"], "run")
                if run['meta'].get('brief'):
                    resolve_inside(project_root, Path(run['path']) / run['meta']['brief'], 'brief')
                if shots_dir is not None:
                    resolve_inside(project_root, shots_dir / f"{run['name']}.png", "screenshot")
                    resolve_inside(project_root, shots_dir / f"{run['name']}.json", "report")
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    settings = {'width': args.width, 'height': args.height, 'hardware': args.hardware,
                'settle_ms': args.settle_ms, 'device_scale_factor': 2}
    snapshots = {run['name']: stage_snapshot(project_root, run['path'],
                 kind=stage, settings=settings) for run in runs} if args.record_attempt else {}
    completed = set()
    check_id = 'step1' if stage == 'scene' else 'step2'

    def record_unfinished(reason):
        if not args.record_attempt:
            return
        for run in runs:
            if run['name'] not in completed:
                record_stage(project_root, run['path'], f"{check_id}:{run['name']}",
                             shots_dir / f"{run['name']}.json", {
                                 'functional': {'status': 'not_evaluated', 'reason': reason},
                                 'input': {'status': 'not_evaluated'}, 'errors': [reason],
                             }, snapshots[run['name']])

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        record_unfinished('Playwright unavailable')
        print(
            "error: playwright is not installed in this interpreter.\n"
            "       python -m pip install playwright; python -m playwright install chromium",
            file=sys.stderr,
        )
        return 2

    chromium = find_chromium()
    if not chromium or not Path(chromium).exists():
        record_unfinished('Chromium unavailable')
        print(
            "error: no Chromium found. Set GBDATA_CHROMIUM, or install one with\n"
            "       python -m playwright install chromium",
            file=sys.stderr,
        )
        return 2

    print(f"checking {len(runs)} run(s) with {Path(chromium).name} ({'default renderer' if args.hardware else 'ANGLE/SwiftShader'})")
    failures = {}
    started = time.time()

    try:
        with serving(runs_dir, runs_rel, project_root) as base_url, sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True, args=browser_args(args.hardware), executable_path=chromium
            )
            try:
                for run in runs:
                    print(f"  {run['name']:24s} ", end="", flush=True)
                    problems = check_run(
                        browser, base_url, run, runs_rel, shots_dir, args.settle_ms, args.verbose,
                        {'width': args.width, 'height': args.height}, stage=stage, project_root=project_root
                    )
                    if args.record_attempt:
                        report_path = shots_dir / f"{run['name']}.json"
                        recorded = json.loads(report_path.read_text())
                        record_stage(project_root, run['path'], f"{check_id}:{run['name']}", report_path, recorded, snapshots[run['name']])
                    completed.add(run['name'])
                    if problems:
                        failures[run["name"]] = problems
                        print("FAIL")
                    else:
                        print("ok")
            finally:
                browser.close()
    except Exception as exc:
        record_unfinished(f'{type(exc).__name__}: {exc}')
        print(f'error: {exc}', file=sys.stderr)
        return 1

    elapsed = time.time() - started
    print(f"\n{len(runs) - len(failures)}/{len(runs)} passed in {elapsed:.1f}s")
    if shots_dir is not None:
        print(f"screenshots: {args.output}/")

    if failures:
        print("\nfailures:", file=sys.stderr)
        for name, problems in failures.items():
            print(f"\n  {name}", file=sys.stderr)
            for problem in problems:
                print(f"    - {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
