"""Serve the prototypes (any build stage) so they can be opened and played in a browser.

Why a script instead of `python -m http.server`: the prototypes import bare
module specifiers ("three") through an import map, and they import the library
from /assets/. A plain static server in a run folder cannot resolve either. This
one serves the selected project root (so /assets/... resolves) and maps /vendor/...
to that project's pinned npm builds, with a CDN fallback for repository previews.
Copy this stdlib-only file to a generated project's root as serve_step.py.

Contract: --help; non-zero exit + printed reason on failure; no network needed
when required npm dependencies are installed locally; serves read-only, writes nothing.

Usage:
    python forge/serve_step.py                 # any interface, shared URL printed
    python forge/serve_step.py --port 9000
    python forge/serve_step.py --runs runs/step1
    python forge/serve_step.py --host 127.0.0.1  # localhost only
    python serve_step.py --runs runs/step3     # copied standalone project
    python forge/serve_step.py --project-root /path/to/game --runs runs/step1
"""

import argparse
import html
import http.server
import json
import mimetypes
import os
import socket
import socketserver
import sys
from functools import partial
from pathlib import Path

# Windows registries and minimal Pythons lack .mjs; browsers reject it as text/plain.
mimetypes.add_type("text/javascript", ".mjs")

# A repository tool lives in forge/; the standalone copy lives at the project root.
# Check the skill marker too, so a project named "forge" still serves itself.
_SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = (
    _SCRIPT_DIR.parent
    if _SCRIPT_DIR.name == "forge" and (_SCRIPT_DIR.parent / "SKILL.md").is_file()
    else _SCRIPT_DIR
)

# Stage-1 dependency pin. Kept here so the fallback cannot silently float.
THREE_VERSION = "0.161.0"
RAPIER_VERSION = "0.14.0"
THREE_CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/build/three.module.js"
RAPIER_CDN = (
    f"https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@{RAPIER_VERSION}/rapier.es.js"
)

# Local vendored copies, preferred over the CDN so the viewer works offline.
LOCAL_THREE = Path("node_modules/three/build/three.module.js")
LOCAL_RAPIER = Path("node_modules/@dimforge/rapier3d-compat/rapier.es.js")

VENDOR_MAP = {
    "/vendor/three.module.js": (LOCAL_THREE, THREE_CDN),
    "/vendor/rapier.es.js": (LOCAL_RAPIER, RAPIER_CDN),
}


# The card metadata, newest stage first. There are exactly three build stages.
META_NAMES = ("step3.json", "step2.json", "step1.json")


def discover_runs(runs_dir: Path):
    """Every immediate subfolder holding an index.html, plus its meta if present.

    Folders starting with '_' are skipped: that is where the shared template
    lives, and it is not a run.
    """
    runs = []
    if not runs_dir.is_dir():
        return runs

    for entry in sorted(runs_dir.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        if not (entry / "index.html").is_file():
            continue

        meta = {}
        for meta_name in META_NAMES:
            meta_path = entry / meta_name
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                meta = {"error": f"{meta_name} does not parse: {exc}"}
            break
        runs.append({"name": entry.name, "path": entry, "meta": meta})
    return runs


def _row(run, runs_rel: str) -> str:
    meta = run["meta"]
    name = html.escape(run["name"])
    url = f"/{runs_rel}/{name}/"

    scheme = html.escape(str(meta.get("control_scheme", "?")))
    modality = html.escape(str(meta.get("player_modality", "?")))
    verb = html.escape(str(meta.get("core_verb", "")))
    gate = html.escape(str(meta.get("gate", "")))
    modules = meta.get("modules", [])
    controls = meta.get("controls", [])

    module_html = "".join(f"<code>{html.escape(str(m))}</code>" for m in modules)
    controls_html = " &nbsp;·&nbsp; ".join(html.escape(str(c)) for c in controls)
    error_html = (
        f'<p class="err">{html.escape(str(meta["error"]))}</p>' if "error" in meta else ""
    )

    return f"""
    <article class="card">
      <header>
        <a class="title" href="{url}">{name}</a>
        <span class="tag">{scheme}</span><span class="tag alt">{modality}</span>
      </header>
      <p class="verb">{verb}</p>
      {error_html}
      <div class="modules">{module_html}</div>
      <p class="controls">{controls_html}</p>
      <p class="gate">{gate}</p>
      <a class="play" href="{url}">play &rarr;</a>
    </article>
    """


def render_index(runs, runs_rel: str) -> bytes:
    if runs:
        body = "".join(_row(run, runs_rel) for run in runs)
        empty = ""
    else:
        body = ""
        empty = (
            '<p class="empty">No runs found. Each run is a folder under '
            f"<code>{html.escape(runs_rel)}/</code> containing an "
            "<code>index.html</code>.</p>"
        )

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game prototypes</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 28px 32px 48px; background: #0d1017; color: #dbe4f0;
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }}
  h1 {{ margin: 0 0 4px; font-size: 19px; font-weight: 600; }}
  .lede {{ margin: 0 0 24px; color: #8fa0b8; font-size: 13px; max-width: 78ch; }}
  .grid {{
    display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  }}
  .card {{
    background: #151a24; border: 1px solid #232c3b; border-radius: 8px;
    padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 8px;
  }}
  .card header {{ display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
  .title {{ color: #cfe0ff; font-weight: 600; text-decoration: none; font-size: 14px; }}
  .title:hover {{ text-decoration: underline; }}
  .tag {{
    font: 11px ui-monospace, monospace; color: #9ad0b0;
    background: #17281f; border: 1px solid #245038; border-radius: 999px;
    padding: 1px 8px;
  }}
  .tag.alt {{ color: #c3b3f0; background: #1f1b2b; border-color: #3b3168; }}
  .verb {{ margin: 0; color: #aebdd2; font-size: 12.5px; }}
  .modules {{ display: flex; flex-wrap: wrap; gap: 4px; }}
  .modules code {{
    font: 10.5px ui-monospace, monospace; color: #8fb8e8;
    background: #131c28; border: 1px solid #24374d; border-radius: 4px;
    padding: 1px 6px;
  }}
  .controls {{ margin: 0; font: 11px ui-monospace, monospace; color: #7f8fa6; }}
  .gate {{ margin: 0; color: #6f7f96; font-size: 11.5px; font-style: italic; }}
  .err {{ margin: 0; color: #ff9d9d; font: 11px ui-monospace, monospace; }}
  .play {{
    margin-top: auto; align-self: flex-start; color: #0e1218; background: #7fb3ff;
    text-decoration: none; font-size: 12px; font-weight: 600;
    padding: 5px 12px; border-radius: 5px;
  }}
  .empty {{ color: #8fa0b8; }}
  footer {{ margin-top: 28px; color: #66748a; font-size: 11.5px; }}
  code.inline {{ font: 11.5px ui-monospace, monospace; color: #9bb4d4; }}
</style>
</head>
<body>
  <h1>Game prototypes</h1>
  <p class="lede">
    Open a prototype to try its controls and review its current acceptance gate.
    Each card describes the artifact served from the selected runs directory.
  </p>
  {empty}
  <div class="grid">{body}</div>
  <footer>
    Pinned to three@{THREE_VERSION} + rapier3d-compat@{RAPIER_VERSION}.
    Served from the project root, so <code class="inline">/assets/</code> resolves.
  </footer>
</body>
</html>
"""
    return page.encode("utf-8")


class Step1Handler(http.server.SimpleHTTPRequestHandler):
    """Static handler over a project root, with /vendor/ and a generated index."""

    def __init__(self, *args, runs_dir: Path, runs_rel: str, project_root=REPO_ROOT, **kwargs):
        self.runs_dir = runs_dir
        self.runs_rel = runs_rel
        self.project_root = Path(project_root).resolve()
        super().__init__(*args, directory=str(self.project_root), **kwargs)

    def do_GET(self):  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]

        # Browsers request this unprompted. A 404 here is pure noise and would
        # otherwise fail check_step1.py's "no failed requests" rule.
        if path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if path in ("/", "/index.html"):
            payload = render_index(discover_runs(self.runs_dir), self.runs_rel)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if path in VENDOR_MAP:
            local, cdn = VENDOR_MAP[path]
            local = self.project_root / local
            if local.is_file():
                payload = local.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            # Not installed locally: bounce the browser to the pinned CDN build.
            self.send_response(302)
            self.send_header("Location", cdn)
            self.end_headers()
            return

        super().do_GET()

    def end_headers(self):
        self.send_header('X-GameBlocks-Pid', str(os.getpid()))
        # A launcher that starts the server through a shell (Windows) cannot match on PID; it sets a token instead.
        owner = os.environ.get('GAMEBLOCKS_OWNER')
        if owner:
            self.send_header('X-GameBlocks-Owner', owner)
        # These prototypes are edited and reloaded constantly; a cached stale
        # main.js is the most confusing possible failure.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        # One quiet line per request, and never for successful asset fetches.
        status = str(args[1]) if len(args) > 1 else ""
        if status.startswith("2") or status.startswith("3"):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


class ReusableServer(socketserver.ThreadingTCPServer):
    # Threading matters: a stalled module fetch must not block the page.
    allow_reuse_address = True
    daemon_threads = True


def lan_ip() -> str:
    """The machine's primary LAN address, or "" when none can be determined.

    No packet is actually sent: connect() on a UDP socket only picks the route,
    which is enough to learn which local address others on the network would
    reach us through.
    """
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return ""
    finally:
        probe.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Serve the prototypes (any stage) for browser review."
    )
    parser.add_argument("--project-root", type=Path, default=REPO_ROOT,
                        help="root containing assets, node_modules and runs (default: script's project)")
    parser.add_argument("--port", type=int, default=8017, help="port (default: 8017)")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="bind host (default: 0.0.0.0, all interfaces; use 127.0.0.1 for localhost only)",
    )
    parser.add_argument(
        "--runs",
        default="runs/step1",
        help="directory of run folders, relative to --project-root",
    )
    args = parser.parse_args(argv)

    project_root = args.project_root.resolve()
    if not project_root.is_dir():
        print(f"error: no project directory: {project_root}", file=sys.stderr)
        return 2
    runs_dir = (project_root / args.runs).resolve()
    if not runs_dir.is_relative_to(project_root):
        print("error: --runs must stay inside the project root", file=sys.stderr)
        return 2
    runs_rel = runs_dir.relative_to(project_root).as_posix()

    runs = discover_runs(runs_dir)
    if not runs_dir.is_dir():
        print(f"warning: {args.runs} does not exist yet", file=sys.stderr)

    if not (project_root / LOCAL_THREE).is_file():
        print(
            f"note: {LOCAL_THREE} is absent; "
            "the browser will be redirected to the pinned jsdelivr build "
            "(requires network). Run `npm install` to serve it locally.",
            file=sys.stderr,
        )

    handler = partial(Step1Handler, runs_dir=runs_dir, runs_rel=runs_rel, project_root=project_root)
    try:
        server = ReusableServer((args.host, args.port), handler)
    except OSError as exc:
        print(f"error: cannot bind {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 2

    print(f"prototype viewer: http://127.0.0.1:{server.server_address[1]}/")
    if args.host in ("0.0.0.0", "::"):
        ip = lan_ip()
        if ip:
            print(f"  share with others on your network: http://{ip}:{server.server_address[1]}/")
    print(f"  serving project root: {project_root}")
    print(f"  runs directory:    {args.runs} ({len(runs)} run(s) found)")
    print("  Ctrl-C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
