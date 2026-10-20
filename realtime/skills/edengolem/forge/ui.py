"""Create a UI layer or style existing DOM, plus an isolated presentation preview.

Copies a dependency-free runtime closure; never patches gameplay JS. A conflict
fails before writes. Re-run identical input safely, or edit the generated config.
"""
import argparse
import json
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

from _shared.paths import resolve_inside
from scaffold import ROOT, asset_closure, encoded, write_new


class InertHTML(HTMLParser):
    """Keep markup/styles for adaptation previews; remove executable scripts."""
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.result, self.script = [], False

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.script = True
        elif not self.script:
            if (tag in ('base', 'iframe', 'object', 'embed')
                    or any(k.startswith('on') or str(v).strip().lower().startswith('javascript:') for k, v in attrs)):
                raise ValueError('adapt preview needs inert markup without embedded runtimes, base tags or inline handlers')
            self.result.append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag == 'script':
            self.script = False

    def handle_endtag(self, tag):
        if tag == 'script':
            self.script = False
        elif not self.script:
            self.result.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.script:
            self.result.append(data)

    def handle_entityref(self, name):
        self.handle_data(f'&{name};')

    def handle_charref(self, name):
        self.handle_data(f'&#{name};')

    def handle_decl(self, data):
        self.handle_data(f'<!{data}>')


PREVIEW_JS = '''const { mode, config } = await (await fetch(new URL('./config.json', import.meta.url))).json();
const { createGameUI, adaptGameUI } = await import(mode === 'create'
  ? '/assets/user-interface/GameUiFactory.js' : '/assets/user-interface/GameUiAdapter.js');
const cases = await (await fetch(new URL('./fixtures.json', import.meta.url))).json();
const baseline = document.body.cloneNode(true);
let ui;
const actions = [];
function show(index) {
  ui?.dispose(); actions.length = 0;
  document.body.replaceChildren(...[...baseline.childNodes].map(n => n.cloneNode(true)));
  const fixture = cases[index];
  if (mode === 'create') {
    const handlers = Object.fromEntries(config.components.flatMap(c => (c.buttons || []).map(b => [b.id, () => actions.push(b.id)])));
    ui = createGameUI({ ...config, actions: handlers, state: fixture.state });
  } else {
    ui = adaptGameUI(config);
    for (const [selector, value] of Object.entries(fixture.dom || {})) {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Fixture selector missing: ${selector}`);
      if (value.text !== undefined) el.textContent = value.text;
      if (value.hidden !== undefined) { el.hidden = value.hidden; el.style.display = value.hidden ? 'none' : ''; }
    }
  }
}
window.__uiPreview = { cases, show, actions, mode };
show(0);
'''


def validate_config(mode, config):
    export = 'resolveUIConfig' if mode == 'create' else 'resolveAdaptConfig'
    module = ROOT / 'assets/user-interface' / ('GameUiFactory.js' if mode == 'create' else 'GameUiAdapter.js')
    script = f'import {{ {export} }} from {json.dumps(module.as_uri())}; let s=""; for await (const c of process.stdin) s+=c; {export}(JSON.parse(s));'
    result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(config),
                            capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise ValueError(result.stderr.strip())


def prepare(root, run_value, mode, config, fixtures, dry_run=False):
    root = Path(root).resolve()
    run = resolve_inside(root, run_value, 'run')
    html = resolve_inside(root, run / 'index.html', 'index')
    if not any((run / f'step{i}.json').is_file() for i in (1, 2, 3)):
        raise ValueError('UI design requires a UI run card')
    validate_config(mode, config)
    if not isinstance(fixtures, list) or not fixtures:
        raise ValueError('fixtures needs at least one representative display state')
    for fixture in fixtures:
        if not isinstance(fixture, dict) or not isinstance(fixture.get('name'), str) or not fixture['name'].strip():
            raise ValueError('each fixture needs a name')
        if not isinstance(fixture.get('state' if mode == 'create' else 'dom'), dict):
            raise ValueError('each fixture needs state (create) or dom (adapt)')
    runtime = 'GameUiFactory.js' if mode == 'create' else 'GameUiAdapter.js'
    files, _, _ = asset_closure([f'assets/user-interface/{runtime}', 'assets/user-interface/game-ui.css'])
    prefix = run.relative_to(root).as_posix()
    source = html.read_text()
    css = '<link rel="stylesheet" href="/assets/user-interface/game-ui.css">'
    extra = '\n<script type="module" src="./ui/adapt.js"></script>' if mode == 'adapt' else ''
    if source.count('</head>') != 1 or source.count('</body>') != 1:
        raise ValueError('index.html needs one </head> and one </body> insertion point')
    additions = (css if css not in source else '') + (extra if extra and extra.strip() not in source else '')
    if additions:
        source = source.replace('</head>', additions + '\n</head>')
    files[f'{prefix}/index.html'] = source.encode()
    files[f'{prefix}/ui/config.json'] = encoded({'mode': mode, 'config': config})
    files[f'{prefix}/ui/fixtures.json'] = encoded(fixtures)
    if mode == 'create':
        entry = """import { createGameUI } from '/assets/user-interface/GameUiFactory.js';
const { config } = await (await fetch(new URL('./config.json', import.meta.url))).json();
export function mountUI({ state, actions, mount } = {}) {
  return createGameUI({ ...config, state, actions, mount });
}
"""
        files[f'{prefix}/ui/view.js'] = entry.encode()
        preview = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' + css + '<style>body{margin:0;background:#1c343b}</style></head><body></body></html>'
    else:
        files[f'{prefix}/ui/adapt.js'] = b"import { adaptGameUI } from '/assets/user-interface/GameUiAdapter.js';\nconst { config } = await (await fetch(new URL('./config.json', import.meta.url))).json();\nexport const ui = adaptGameUI(config);\n"
        inert = InertHTML(); inert.feed(source); preview = ''.join(inert.result)
        preview = preview.replace('</head>', '<base href="../"></head>')
    script = './preview.js' if mode == 'create' else './ui/preview.js'
    preview = preview.replace('</body>', f'<script type="module" src="{script}"></script></body>')
    files[f'{prefix}/ui/preview.html'] = preview.encode()
    files[f'{prefix}/ui/preview.js'] = PREVIEW_JS.encode()
    write_new(root, files, replace=(f'{prefix}/index.html',), dry_run=dry_run)
    return {'mode': mode, 'files': sorted(files), 'preview': f'{prefix}/ui/preview.html',
            'integration': 'Call mountUI with existing state/actions' if mode == 'create' else 'Existing DOM nodes/listeners preserved',
            'dry_run': dry_run}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['create', 'adapt'])
    parser.add_argument('--project-root', required=True, type=Path)
    parser.add_argument('--run', required=True)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--fixtures', required=True, type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = prepare(args.project_root, args.run, args.mode, json.loads(args.config.read_text()),
                         json.loads(args.fixtures.read_text()), args.dry_run)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
