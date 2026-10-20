"""Check-specific source closures and execution context; never execute game code.

Unresolved loaders retain a whole-project snapshot and disable automatic reuse.
The file graph is rebuilt on validation, so changed imports/additions cannot hide
behind an old list of paths. Reports and review notes are outputs, not sources.
"""
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from functools import lru_cache
from pathlib import Path
from urllib.parse import unquote, urlsplit

from _shared.attempts import file_hashes, sha256_file
from _shared.paths import resolve_inside
from _shared.run_contract import read_meta

ROOT = Path(__file__).resolve().parents[2]
FORMAT = 'gameblocks-check-inputs/v1'
KINDS = {'scene', 'behavior', 'closure', 'acceptance', 'runtime', 'rounds'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.scripts, self.styles, self.uncertain = [], [], [], []
        self.imports = {}
        self.current = None
        self.buffer = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'base' or 'srcset' in attrs or 'srcdoc' in attrs or any(key.startswith('on') for key in attrs):
            self.uncertain.append('HTML base, srcset or inline event handler')
        for key in ('src', 'poster', 'data'):
            if attrs.get(key):
                self.refs.append(attrs[key])
        if tag != 'a' and attrs.get('href'):
            self.refs.append(attrs['href'])
        if attrs.get('xlink:href'):
            self.refs.append(attrs['xlink:href'])
        self.styles.extend(value for value in attrs.values() if value and 'url(' in value)
        if tag in ('script', 'style'):
            self.current = 'importmap' if attrs.get('type') == 'importmap' else tag
            self.buffer = ''
        if 'style' in attrs:
            self.styles.append(attrs['style'])

    def handle_data(self, data):
        if self.current:
            self.buffer += data

    def handle_endtag(self, tag):
        if tag not in ('script', 'style') or not self.current:
            return
        if self.current == 'script':
            self.scripts.append(self.buffer)
        elif self.current == 'style':
            self.styles.append(self.buffer)
        else:
            try:
                mapping = json.loads(self.buffer)
                if mapping.get('scopes'):
                    self.uncertain.append('scoped import map')
                self.imports.update(mapping.get('imports', {}))
            except (ValueError, TypeError):
                self.uncertain.append('invalid import map')
        self.current = None


def js_refs(sources):
    if not sources:
        return []
    try:
        return json.loads(parse_sources(json.dumps(sources), context_file(ROOT / 'forge/_shared/dependency_refs.mjs')))
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return [{'id': row['id'], 'refs': [], 'uncertain': [str(exc)]} for row in sources]


@lru_cache(maxsize=128)
def parse_sources(source, parser_hash):
    result = subprocess.run([shutil.which('node') or 'node', str(ROOT / 'forge/_shared/dependency_refs.mjs')],
                            input=source, capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError('parser unavailable; run npm ci in the skill checkout')
    return result.stdout


@lru_cache(maxsize=512)
def cached_context_file(path, signature):
    return sha256_file(path)


def context_file(path):
    """Avoid rehashing large immutable executables; invalidate on every file stat change."""
    stat = path.stat()
    return cached_context_file(path, (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))


def closure(root, entries):
    """Return local runtime paths and uncertainty; packages are bound as installed trees."""
    root = Path(root).resolve()
    pending, files, uncertain, imports = list(entries), set(), [], {}

    def add_ref(owner, ref):
        if not isinstance(ref, str):
            uncertain.append(f'{owner}: non-string reference')
            return
        if ref in imports:
            owner, ref = imports[ref]
        url = urlsplit(ref)
        if url.scheme == 'data' or ref.startswith('#'):
            return
        if url.scheme or url.netloc:
            uncertain.append(f'{owner}: external resource')
            return
        ref = unquote(url.path)
        vendors = {'/vendor/three.module.js': 'three', '/vendor/rapier.es.js': '@dimforge/rapier3d-compat'}
        vendor = ref in vendors
        if vendor:
            ref = vendors[ref]
        if ref.startswith('/'):
            pending.append(root / ref.lstrip('/'))
        elif ref.startswith(('./', '../')) or (owner.suffix in ('.html', '.css') and not vendor):
            pending.append(owner.parent / ref)
        else:
            package = '/'.join(ref.split('/')[:2]) if ref.startswith('@') else ref.split('/')[0]
            path = root / 'node_modules' / package
            files.add(path)
            # Pin installed package bytes, including WASM/data. Arbitrary package
            # loaders cannot be proven closed by this local-source scanner.
            if package not in ('three', '@dimforge/rapier3d-compat'):
                uncertain.append(f'{owner}: unanalysed package {package}')
            elif not path.is_dir():
                uncertain.append(f'{owner}: package missing {package}')

    while pending:
        sources, owners = [], {}
        while pending:
            path = resolve_inside(root, pending.pop(), 'check dependency')
            if path in files:
                continue
            files.add(path)
            if not path.is_file():
                uncertain.append(f'{path.relative_to(root)}: missing dependency')
                continue
            suffix = path.suffix.lower()
            if suffix not in ('.js', '.mjs', '.cjs', '.html', '.css'):
                continue
            source = path.read_text(encoding='utf-8')
            scripts, styles = [source], []
            if suffix == '.html':
                page = PageReferences()
                page.feed(source)
                imports.update({key: (path, value) for key, value in page.imports.items()})
                scripts, styles = page.scripts, page.styles
                uncertain.extend(f'{path.relative_to(root)}: {s}' for s in page.uncertain)
                for ref in page.refs:
                    add_ref(path, ref)
            if suffix == '.css':
                scripts, styles = [], [source]
            for style in styles:
                refs = re.findall(r'''url\(\s*['"]?([^'"\s)]+)''', style)
                refs += re.findall(r'''@import\s+['"]([^'"]+)''', style)
                if '\\' in style or re.search(r'url\(\s*(?:var\(|attr\(|\))|image-set\(', style):
                    uncertain.append(f'{path.relative_to(root)}: computed CSS resource')
                for ref in refs:
                    add_ref(path, ref)
            for index, script in enumerate(scripts):
                key = f'{path}:{index}'
                sources.append({'id': key, 'text': script})
                owners[key] = path
        for row in js_refs(sources):
            owner = owners[row['id']]
            uncertain.extend(f'{owner.relative_to(root)}: {s}' for s in row['uncertain'])
            for ref in row['refs']:
                add_ref(owner, ref)
    return sorted(files), sorted(set(uncertain))


def context(kind):
    """Only digests leave this process; no environment secrets are recorded."""
    tool_paths = list((ROOT / 'forge').glob('*.py'))
    tool_paths += [p for p in (ROOT / 'forge/_shared').iterdir() if p.suffix in ('.py', '.mjs')]
    tool_paths += list((ROOT / 'docs/specs').glob('*.schema.json'))
    tool_paths += [ROOT / 'package-lock.json']
    versions = {}
    for package in ('jsonschema', 'playwright'):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = 'missing'
    binaries = [Path(sys.executable)]
    node = shutil.which('node')
    if node:
        binaries.append(Path(node))
    from check_step1 import find_chromium
    chromium = find_chromium()
    if chromium:
        binaries.append(Path(chromium))
    environment = {key: os.environ.get(key) for key in (
        'NODE_OPTIONS', 'NODE_PATH', 'TZ', 'LANG', 'LC_ALL', 'GBDATA_CHROMIUM',
        'DISPLAY', 'WAYLAND_DISPLAY', 'LIBGL_ALWAYS_SOFTWARE', 'MESA_LOADER_DRIVER_OVERRIDE',
        'VK_ICD_FILENAMES', 'CUDA_VISIBLE_DEVICES')}
    environment.update(platform=platform.platform(), machine=platform.machine(), python=sys.version,
                       packages=versions, binaries={str(p): context_file(p) if p.is_file() else 'missing' for p in binaries})
    for name in ('/proc/driver/nvidia/version', '/etc/os-release'):
        path = Path(name)
        if path.is_file():
            environment[name] = context_file(path)
    return {'tools': digest({str(p.relative_to(ROOT)): context_file(p) for p in tool_paths}),
            'environment': digest(environment)}


def snapshot(root, run, extra=(), *, kind='runtime', settings=None):
    from _shared.attempts import Snapshot
    root, run = Path(root).resolve(), resolve_inside(root, run, 'run')
    if kind not in KINDS:
        raise ValueError(f'unknown check dependency kind: {kind}')
    if run.is_file():
        return Snapshot(file_hashes(root, [run, *extra]), {}, None)
    meta = read_meta(run)
    entries = [run / ('round.mjs' if kind == 'rounds' else 'index.html')]
    if kind in ('behavior', 'closure', 'acceptance', 'runtime') and (run / 'round.mjs').is_file():
        entries.append(run / 'round.mjs')
    manifest = meta.get('scene_manifest')
    if isinstance(manifest, str):
        manifest_path = resolve_inside(root, run / manifest, 'scene manifest')
        entries.append(manifest_path)
        if manifest_path.is_file():
            try:
                data = json.loads(manifest_path.read_text(encoding='utf-8'))
            except ValueError:
                data = None  # The gate reports malformed JSON; its bytes remain bound.
            elements = data.get('elements') if isinstance(data, dict) else None
            if isinstance(elements, list):
                for element in elements:
                    asset = element.get('asset') if isinstance(element, dict) else None
                    if isinstance(asset, str) and asset:
                        entries.append(resolve_inside(root, asset.lstrip('/'), 'scene asset'))
    files, uncertain = closure(root, entries)
    # Brief validation consumes the complete brief; do not drop intent changes.
    for field in ('brief', 'parameter_source'):
        if isinstance(meta.get(field), str):
            files.append(resolve_inside(root, run / meta[field], field))
    files.extend(resolve_inside(root, p, 'extra dependency') for p in extra)
    files.extend(root / p for p in ('package.json', 'package-lock.json'))
    if kind in KINDS:
        files.extend(root / p for p in ('serve_step.py', 'launch.sh'))
    metadata = {key:value for key,value in meta.items() if key not in ('gate','out_of_scope','modules','strategy')}
    # Stage moves rewrite the brief path but keep the same content dependency.
    for field in ('brief', 'parameter_source'):
        if field in metadata:
            metadata[field] = '$linked-file'
    if uncertain:
        artifacts, shared = file_hashes(root, [run, *extra]), file_hashes(root, ['.'])
        # Whole-project hashing excludes npm directories. Retain known package
        # and explicit evidence dependencies as well as the conservative fallback.
        shared.update(file_hashes(root, files))
    else:
        artifacts = file_hashes(root, [p for p in files if p.is_relative_to(run)])
        shared = file_hashes(root, [p for p in files if not p.is_relative_to(run)])
    binding = {'format': FORMAT, 'run': run.relative_to(root).as_posix(), 'kind': kind,
               'extra': [resolve_inside(root, p, 'extra').relative_to(root).as_posix() for p in extra],
               'settings': settings or {}, 'metadata': digest(metadata), **context(kind),
               'uncertain': uncertain}
    return Snapshot(artifacts, shared, binding)


def equivalent(left, right):
    """Compare checks across a copied run without conflating output report paths."""
    if not left or not right or left.binding is None or right.binding is None:
        return False
    def normalized(value):
        binding = dict(value.binding)
        run = binding.pop('run')
        if binding['uncertain']:
            return None
        binding['extra'] = [p.replace(run + '/', '$run/', 1) if p.startswith(run + '/') else p for p in binding['extra']]
        def paths(mapping):
            return {('$run/' + p[len(run)+1:] if p.startswith(run + '/') else p): h for p, h in mapping.items()}
        return binding, paths(value[0]), paths(value[1])
    first, second = normalized(left), normalized(right)
    return first is not None and first == second
