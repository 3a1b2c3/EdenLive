"""Launch or relocate a project; check local resources and one real input prefix."""
import argparse
import contextlib
import json
import math
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import quote, urlsplit


def final_stage(root):
    return next((stage for stage in ('step3', 'step2', 'step1')
                 if any((Path(root) / 'runs' / stage).glob('*/index.html'))), 'step3')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def project_server(root, *, stage=None, timeout=10, port=0, log=None):
    base = Path(root).resolve()
    stage = stage or final_stage(base)
    if stage not in {'step1', 'step2', 'step3'}:
        raise ValueError('stage must be step1..step3')
    if not math.isfinite(timeout) or timeout <= 0 or not 0 <= port <= 65535:
        raise ValueError('timeout must be positive and port must be 0..65535')
    if not (base / 'serve_step.py').is_file() or not (base / 'launch.sh').is_file():
        raise FileNotFoundError(f'project needs serve_step.py and launch.sh: {base}')
    selected_port = port or free_port()
    # Verify the delivered launcher from a different working directory.
    command = ['sh', str(base / 'launch.sh'), stage, '--host', '127.0.0.1', '--port', str(selected_port)]
    stream, process = None, None
    try:
        if log:
            log = Path(log).resolve()
            log.parent.mkdir(parents=True, exist_ok=True)
            stream = log.open('w', buffering=1, encoding='utf-8')
        owner = uuid.uuid4().hex
        process = subprocess.Popen(command, cwd=base.parent,
                                   stdout=stream or subprocess.DEVNULL, stderr=subprocess.STDOUT,
                                   env={**os.environ, 'PYTHONUNBUFFERED': '1', 'GAMEBLOCKS_OWNER': owner})
        deadline = time.monotonic() + timeout
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f'http://127.0.0.1:{selected_port}/'
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'server exited with code {process.returncode}; log: {log or "not requested"}')
            try:
                with opener.open(url, timeout=min(.3, timeout)) as response:
                    # A listener on an occupied port must never count as our server.
                    owned = (response.headers.get('X-GameBlocks-Pid') == str(process.pid)
                             or response.headers.get('X-GameBlocks-Owner') == owner)
                    if response.status == 200 and owned:
                        break
            except OSError:
                pass
            time.sleep(.02)
        else:
            raise TimeoutError('HTTP readiness timed out for the owned server')
        yield {'process': process, 'url': url, 'port': selected_port,
               'pid': process.pid, 'log': str(log) if log else None}
    finally:
        if process is not None and process.poll() is None:
            if os.name == 'nt':
                # The shell wrapper does not exec on Windows; end the whole tree or the server outlives the check.
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
            else:
                process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        if stream is not None:
            stream.close()


def relocation_check(root, destination=None):
    """Copy into a newly owned directory; failures remove only that new copy."""
    source = Path(root).resolve()
    if not source.is_dir() or not (source / 'package-lock.json').is_file():
        raise ValueError('relocation needs a project and package-lock.json for npm ci')
    if destination:
        target = Path(destination).resolve()
        if target == source or target.is_relative_to(source) or source.is_relative_to(target):
            raise ValueError('relocation destination must be separate from the source')
        target.mkdir(parents=True, exist_ok=False)
    else:
        target = Path(tempfile.mkdtemp(prefix='gameblocks relocated '))
    try:
        shutil.copytree(source, target, dirs_exist_ok=True, symlinks=True,
                        ignore=shutil.ignore_patterns('node_modules', '.git', '__pycache__', '*.log', '*.pid'))
        for path in target.rglob('*'):
            if path.is_symlink():
                raise ValueError(f'relocated runtime must contain copied files: {path}')
        installed = subprocess.run([shutil.which('npm') or 'npm', 'ci', '--ignore-scripts'], cwd=target, timeout=120,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if installed.returncode:
            raise RuntimeError(f'npm ci failed: {installed.stdout[-2000:]}')
        return target
    except BaseException:
        shutil.rmtree(target)
        raise


def check_project(root, base_url, *, stage=None, only=None, input_check=None,
                  timeout=10, width=960, height=640, hardware=False):
    """Check one meaningful input prefix per run, blocking external resources."""
    base = Path(root).resolve()
    stage = stage or final_stage(base)
    from playwright.sync_api import sync_playwright
    from check_step1 import canvas_report, find_chromium, wait_for_boot
    from serve_step import discover_runs
    from _shared.browser_input import check_inputs
    from _shared.paths import resolve_inside
    from _shared.runtime import browser_args

    base = Path(root).resolve()
    runs = discover_runs(base / 'runs' / stage)
    if only:
        runs = [run for run in runs if run['name'] == only]
    if not runs:
        raise ValueError('no selected game run found')
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=find_chromium(), args=browser_args(hardware))
        try:
            for run in runs:
                resolve_inside(base, run['path'], 'run')
                errors, external, resources, observations = [], [], [], []
                with browser.new_context(viewport={'width': width, 'height': height}, service_workers='block') as context:
                    def route_request(route):
                        url = urlsplit(route.request.url)
                        if url.scheme in {'data', 'blob'} or (url.scheme == 'http' and url.netloc == urlsplit(base_url).netloc):
                            route.continue_()
                        else:
                            external.append(route.request.url)
                            route.abort()
                    context.route('**/*', route_request)
                    page = context.new_page()
                    page.set_default_timeout(timeout * 1000)
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
                    page.on('requestfailed', lambda req: errors.append(f'{req.url}: {req.failure}'))
                    def response_seen(response):
                        resources.append({'url': response.url, 'status': response.status})
                        if response.status >= 400:
                            errors.append(f'HTTP {response.status}: {response.url}')
                    page.on('response', response_seen)
                    input_status, reason = 'not_evaluated', 'no declared success case; supply equivalent input evidence'
                    try:
                        page.goto(f'{base_url}runs/{stage}/{quote(run["name"])}/', wait_until='load')
                        boot = wait_for_boot(page, timeout_ms=timeout * 1000)
                        if not boot['ok']:
                            raise ValueError(boot['reason'])
                        card = run['meta']
                        checks = card.get('input_checks', [])
                        successes = [name for row in card.get('signature_actions', []) for name in row.get('success_checks', [])]
                        name = input_check or (successes[0] if successes else None)
                        index = next((i for i, case in enumerate(checks) if case.get('name') == name), None)
                        if index is not None:
                            input_status = 'failed'
                            input_errors = check_inputs(page, checks[:index + 1], observations)
                            errors.extend(input_errors)
                            input_status = 'failed' if input_errors else 'passed'
                            reason = f'declared input prefix through {name}'
                        elif input_check:
                            errors.append(f'unknown input check: {input_check}')
                        boot = canvas_report(page)
                        if not boot['ok']:
                            errors.append(boot['reason'])
                    except Exception as exc:
                        errors.append(f'{type(exc).__name__}: {exc}')
                    errors.extend(f'external runtime request: {url}' for url in external)
                    results.append({'run': run['name'], 'status': 'failed' if errors else input_status,
                                    'input': {'status': input_status, 'reason': reason, 'observations': observations},
                                    'resources': resources, 'errors': errors})
        finally:
            browser.close()
    statuses = {row['status'] for row in results}
    return {'scope': 'local resource load and real input; full rounds remain Stage 3 evidence',
            'status': 'failed' if 'failed' in statuses else 'not_evaluated' if 'not_evaluated' in statuses else 'passed',
            'runs': results}


def _remove_owned_pid(path, pid):
    if not path or pid is None:
        return
    try:
        if Path(path).read_text().strip() == str(pid):
            Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _interrupted(*_args):
    raise KeyboardInterrupt()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--stage', choices=['step1', 'step2', 'step3'], default=None, help='default: latest populated stage (step3, step2, step1)')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--timeout', type=float, default=10)
    parser.add_argument('--log', type=Path)
    parser.add_argument('--output', type=Path, help='save the check report (relative to the original project root)')
    parser.add_argument('--relocate', nargs='?', const='__auto__', help='new destination, or a disposable temp copy')
    parser.add_argument('--check', action='store_true', help='check local resources and a declared input case, then exit')
    parser.add_argument('--keep-relocated', action='store_true')
    parser.add_argument('--pid-file', type=Path)
    parser.add_argument('--only', help='run name (default: all runs in the selected stage)')
    parser.add_argument('--input-check', help='last input check in a prefix (default: first signature success)')
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--height', type=int, default=640)
    parser.add_argument('--hardware', action='store_true')
    args = parser.parse_args(argv)
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 120 or not 0 <= args.port <= 65535:
        parser.error('timeout must be > 0 and <= 120; port must be 0..65535')
    if not 64 <= args.width <= 4096 or not 64 <= args.height <= 4096:
        parser.error('viewport must be 64..4096')
    root, relocated, owned_pid = args.project_root.resolve(), None, None
    previous_signal = signal.signal(signal.SIGTERM, _interrupted)
    try:
        if args.relocate is not None:
            relocated = relocation_check(root, None if args.relocate == '__auto__' else args.relocate)
            root = relocated
            print(f'relocated={root}', flush=True)
        with project_server(root, stage=args.stage, port=args.port, timeout=args.timeout, log=args.log) as info:
            print(info['url'], flush=True)
            print(f"pid={info['pid']} port={info['port']}", flush=True)
            if args.pid_file:
                args.pid_file.parent.mkdir(parents=True, exist_ok=True)
                with args.pid_file.open('x') as stream:
                    stream.write(f"{info['pid']}\n")
                owned_pid = info['pid']
            if args.check or args.relocate is not None:
                report = check_project(root, info['url'], stage=args.stage, only=args.only, input_check=args.input_check,
                                       timeout=args.timeout, width=args.width, height=args.height, hardware=args.hardware)
                if args.output:
                    output = args.project_root.resolve() / args.output
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
                print(json.dumps(report, ensure_ascii=False), flush=True)
                return 0 if report['status'] == 'passed' else 1
            return info['process'].wait()
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_signal)
        _remove_owned_pid(args.pid_file, owned_pid)
        if relocated and args.relocate == '__auto__' and not args.keep_relocated:
            shutil.rmtree(relocated, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
