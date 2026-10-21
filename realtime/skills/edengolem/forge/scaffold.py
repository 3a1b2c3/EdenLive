"""Initialize a standalone scene, copy selected runtime closures, or advance a verified run.

Existing conflicting files fail before writes. No command grants a gameplay pass.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from _shared.constants import STAGES
from _shared.paths import resolve_inside
from _shared.state import state_errors
from _shared.starters import blank_strategy, prepare_behavior_card, scene_manifest, starter_strategy
from validate_game_brief import validate_brief
from validate_run_meta import validate_meta

ROOT = Path(__file__).resolve().parents[1]
PINNED = {'three': '0.161.0', '@dimforge/rapier3d-compat': '0.14.0'}


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def asset_closure(entries, extras=(), source=ROOT, dynamic_note=None):
    """Resolve literal ES imports/re-exports, fetch, Worker and new URL references.

    This is a conservative scanner, not a JS evaluator. Computed loaders require an
    explicit review note and extra files; runtime network checks remain necessary.
    """
    assets = (source / 'assets').resolve()
    pending = [resolve_inside(source, p.lstrip('/'), 'asset') for p in [*entries, *extras]]
    files, packages, unresolved = {}, set(), []
    while pending:
        path = pending.pop()
        if not path.is_relative_to(assets) or not path.is_file():
            raise ValueError(f'not a runtime asset file: {path}')
        rel = path.relative_to(source).as_posix()
        if rel in files:
            continue
        data = path.read_bytes()
        files[rel] = data
        if path.suffix not in ('.js', '.mjs', '.css'):
            continue
        text = data.decode()
        # Remove comments while preserving quoted strings and template strings.
        text = re.sub(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`)|//[^\n]*|/\*[\s\S]*?\*/',
                      lambda m: m[1] or '', text)
        refs = re.findall(r'''(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\bfetch\s*\(\s*|\bnew\s+(?:URL|Worker|SharedWorker)\s*\(\s*)['"]([^'"]+)['"]''', text)
        refs += re.findall(r'''url\(\s*['"]?([^'"\s)]+)''', text)
        if re.search(r'\b(?:import|fetch)\s*\(\s*(?![\s\'"])\S|\bnew\s+(?:URL|Worker|SharedWorker)\s*\(\s*(?![\s\'"]|new\s+URL)\S', text):
            unresolved.append(rel)
        for ref in refs:
            if ref.startswith(('./', '../', '/assets/')):
                target = (source / ref.lstrip('/')) if ref.startswith('/') else path.parent / ref
                pending.append(target.resolve())
            elif ref.startswith(('http:', 'https:', 'data:', 'blob:', '/')):
                unresolved.append(f'{rel}: {ref}')
            else:
                package = '/'.join(ref.split('/')[:2]) if ref.startswith('@') else ref.split('/')[0]
                if package not in PINNED:
                    raise ValueError(f'install and map unsupported package explicitly before manual copy: {package}')
                packages.add(package)
    if unresolved and not dynamic_note:
        raise ValueError(f'computed/external runtime references need --extra files and --dynamic-note: {unresolved}')
    # Library-level notices, if supplied, accompany every closure.
    for base in (source, assets):
        for path in base.iterdir():
            if path.is_file() and path.name.upper().startswith(('LICENSE', 'NOTICE', 'COPYING')):
                files[f'assets/notices/{base.name}-{path.name}'] = path.read_bytes()
    return files, packages, unresolved


def write_new(root, files, replace=(), directories=(), dry_run=False):
    """Check every destination before changing any file; identical files are reusable."""
    for relative in [*files, *directories]:
        path = resolve_inside(root, relative, 'destination')
        for parent in path.parents:
            if parent == root.parent:
                break
            if parent.exists() and not parent.is_dir():
                raise ValueError(f'destination parent is not a directory (preserved): {parent}')
        if relative in directories:
            if path.exists() and not path.is_dir():
                raise ValueError(f'destination is not a directory (preserved): {path}')
        elif path.exists() and (not path.is_file() or path.read_bytes() != files[relative]) and relative not in replace:
            raise ValueError(f'conflicting file (preserved): {path}')
    if dry_run:
        return
    for relative in directories:
        (root / relative).mkdir(parents=True, exist_ok=True)
    for relative, data in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)


def copy_assets(root, entries, extras=(), source=ROOT, dynamic_note=None):
    files, packages, unresolved = asset_closure(entries, extras, source, dynamic_note)
    manifest = root / 'package.json'
    deps = json.loads(manifest.read_text()).get('dependencies', {})
    if any(deps.get(name) != PINNED[name] for name in packages):
        raise ValueError(f'install pinned runtime dependencies before copying: {sorted(packages)}')
    # Content-addressed copy receipts never replace earlier provenance.
    receipt = encoded({'files': {p: hashlib.sha256(data).hexdigest() for p, data in sorted(files.items())},
                       'unresolved': unresolved, 'dynamic_note': dynamic_note})
    files[f'assets/receipts/{hashlib.sha256(receipt).hexdigest()[:16]}.json'] = receipt
    write_new(root, files)
    return sorted(files)


def initialize(root, name, brief_path, entries=(), extras=(), rapier=False, install=True, dynamic_note=None):
    brief = json.loads(brief_path.read_text())
    errors = validate_brief(brief)
    if errors:
        raise ValueError('; '.join(e.message for e in errors))
    if (root / '.state.json').exists() or (root / f'runs/step1/{name}').exists():
        raise ValueError('project already initialized; resume existing state or use advance')
    assets, packages, unresolved = asset_closure(
        ['assets/user-interface/PrototypeShell.js', 'assets/math/TimeUtils.js', *entries], extras,
        dynamic_note=dynamic_note)
    packages.add('three')
    if rapier:
        packages.add('@dimforge/rapier3d-compat')
    manifest_path = root / 'package.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    if manifest.get('type', 'module') != 'module' or manifest.get('private', True) is not True:
        raise ValueError('existing package type/private conflicts; reconcile it explicitly')
    for group in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
        for package in packages:
            if package in manifest.get(group, {}) and manifest[group][package] != PINNED[package]:
                raise ValueError(f'existing {group}.{package} conflicts with {PINNED[package]}')
    manifest.update(private=True, type='module')
    manifest.setdefault('dependencies', {}).update({p: PINNED[p] for p in packages})
    run = f'runs/step1/{name}'
    state = {'current_stage': 'intake', 'stages': {s: {'status': 'not_started', 'loop_count': 0, 'evidence': []} for s in STAGES}}
    state['stages']['intake'].update(status='in_progress', artifact='brief.json', evidence=['brief.json', 'evidence/brief-validation.json'])
    state['stages']['scene'].update(artifact=run)
    meta = {k: brief[k] for k in ('control_scheme', 'player_modality', 'core_verb')}
    meta.update(brief='../../../brief.json', controls=[], modules=['/' + p for p in sorted(assets) if p.endswith(('.js', '.mjs'))],
                gate='Complete brief-derived static scene; behavior and acceptance follow in later stages.',
                scene_manifest='scene-manifest.json',
                capabilities=[],
                signature_actions=[])
    receipt = encoded({'files': {p: hashlib.sha256(data).hexdigest() for p, data in sorted(assets.items())},
                       'unresolved': unresolved, 'dynamic_note': dynamic_note})
    files = {**assets, 'package.json': encoded(manifest), 'brief.json': encoded(brief), '.state.json': encoded(state),
             'evidence/brief-validation.json': encoded({'status': 'passed', 'check': 'brief schema only', 'intentReview': 'not_evaluated', 'briefSha256': hashlib.sha256(encoded(brief)).hexdigest()}),
             f'{run}/step1.json': encoded(meta), 'serve_step.py': (ROOT / 'forge/serve_step.py').read_bytes(),
             'launch.sh': (ROOT / 'assets/template/launch.sh').read_bytes(),
             f'assets/receipts/{hashlib.sha256(receipt).hexdigest()[:16]}.json': receipt}
    for filename in ('index.html', 'main.js', 'game.mjs', 'game-loop.mjs'):
        files[f'{run}/{filename}'] = (ROOT / 'assets/template' / filename).read_bytes()
    files[f'{run}/scene-manifest.json'] = encoded(scene_manifest(brief))
    # An orphan lockfile has no manifest whose settings can be merged safely.
    if (root / 'package-lock.json').exists() and not manifest_path.exists():
        raise ValueError('orphan package-lock.json preserved; recover its manifest first')
    count = len(STAGES)
    write_new(root, files, replace=('package.json',), directories=tuple(f'runs/step{i}' for i in range(1, count)))
    (root / 'launch.sh').chmod(0o755)
    command = [shutil.which('npm') or 'npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund']
    if not install:
        command.append('--package-lock-only')
    subprocess.run(command, cwd=root, check=True, timeout=180)
    return root / run


def prepare_advance(root, name, source_stage, state):
    """Plan a copy and update an in-memory state; do not write or revalidate state."""
    if source_stage not in STAGES[1:-1]:
        raise ValueError('advance requires scene or behavior')
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', name):
        raise ValueError('name must be a lowercase URL-safe slug')
    index = STAGES.index(source_stage)
    target_stage = STAGES[index + 1]
    record = state['stages'][source_stage]
    if record['status'] != 'passed' or not record.get('artifact'):
        raise ValueError('advance requires a passed source with artifact and recorded evidence')
    if state['stages'][target_stage]['status'] != 'not_started':
        raise ValueError('target stage already started; resume it')
    source = resolve_inside(root, record['artifact'], 'source run')
    if not source.is_dir() or not (source / 'index.html').is_file():
        raise ValueError('source must be a retained runnable artifact')
    destination = resolve_inside(root, f'runs/step{index+1}/{name}', 'target run')
    if destination.exists():
        raise ValueError('target run exists; preserved')
    files = {}
    provenance = {}
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'run symlinks require explicit packaging: {path}')
        relative = path.relative_to(source)
        if not path.is_file() or 'evidence' in relative.parts or path.name in {f'step{i}.json' for i in range(1, len(STAGES))}:
            continue
        files[f'{destination.relative_to(root).as_posix()}/{relative}'] = path.read_bytes()
        provenance[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
    from _shared.run_contract import read_meta
    meta = read_meta(source)
    errors = validate_meta(meta)
    if errors:
        raise ValueError('; '.join(e.message for e in errors))
    # Same-depth run layout preserves local asset imports; brief may have been run-local.
    brief = resolve_inside(root, source / meta['brief'], 'brief')
    meta['brief'] = os.path.relpath(brief, destination)
    meta['gate'] = f'{target_stage}: not evaluated for this artifact'
    prefix = destination.relative_to(root).as_posix()
    if target_stage in ('behavior', 'acceptance'):
        if target_stage == 'behavior':
            prepare_behavior_card(meta, json.loads(brief.read_text()))
        # Behaviour drafts the closure strategy; acceptance inherits the authored copy
        # and extends it. Preserve a copied or explicitly selected strategy either way.
        # An untouched draft is scaffolding rather than authored content: it never
        # outranks a selected or project strategy, and it is redrawn for the new
        # scope so acceptance does not start from a closure sequence.
        # Queries remain read-only.
        local = f'{prefix}/strategy.json'
        if local in files and blank_strategy(files[local]):
            del files[local]
        candidates = [destination / 'strategy.json']
        if meta.get('strategy'):
            candidates.append(destination / meta['strategy'])
        candidates.append(root / 'strategy.json')
        candidates = [resolve_inside(root, path, 'strategy') for path in candidates]
        if not any(path.is_file() or path.relative_to(root).as_posix() in files for path in candidates):
            files[f'{prefix}/strategy.json'] = encoded(
                starter_strategy('closure' if target_stage == 'behavior' else 'acceptance'))
    files[f'{prefix}/step{index+1}.json'] = encoded(meta)
    files[f'{prefix}/source-artifact.json'] = encoded({'artifact': source.relative_to(root).as_posix(),
                                                    'evidence': record['evidence'], 'files': provenance,
                                                    'assessment': 'not_evaluated for the new stage'})
    state['current_stage'] = target_stage
    state['stages'][target_stage].update(status='in_progress', artifact=prefix)
    return destination, files


def commit_transition(root, state, files, destination=None):
    """Preflight all files, then replace state atomically after successful writes.

    On a write failure, remove only files and the run directory created by this call.
    Existing files and the previous state remain available for a retry.
    """
    write_new(root, {**files, '.state.json': encoded(state)}, replace=('.state.json',), dry_run=True)
    owned_run = destination if destination and not destination.exists() else None
    created, temporary = [], None
    try:
        for relative, data in files.items():
            path = resolve_inside(root, relative, 'destination')
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                created.append(path)
                path.write_bytes(data)
        state_path = resolve_inside(root, '.state.json', 'state')
        with tempfile.NamedTemporaryFile(dir=state_path.parent, prefix='.state-', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(encoded(state))
        temporary.replace(state_path)
    except BaseException:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        if owned_run and owned_run.exists():
            shutil.rmtree(owned_run)
        raise
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def advance(root, name, source_stage):
    state = json.loads((root / '.state.json').read_text())
    errors = state_errors(state)
    if errors:
        raise ValueError('; '.join(errors))
    destination, files = prepare_advance(root, name, source_stage, state)
    errors = state_errors(state)
    if errors:
        raise ValueError('; '.join(errors))
    commit_transition(root, state, files, destination)
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'assets', 'advance'])
    parser.add_argument('--project-root', required=True, type=Path)
    parser.add_argument('--name', default='prototype')
    parser.add_argument('--brief', type=Path)
    parser.add_argument('--from-stage', choices=STAGES[1:-1])
    parser.add_argument('--asset', action='append', default=[])
    parser.add_argument('--extra', action='append', default=[], help='explicit data, worker, notice or other runtime file')
    parser.add_argument('--dynamic-note', help='reviewed computed references and how explicit files resolve them')
    parser.add_argument('--rapier', action='store_true')
    parser.add_argument('--lock-only', action='store_true', help='write npm lockfile; run npm ci before launch')
    args = parser.parse_args(argv)
    try:
        if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', args.name):
            raise ValueError('name must be a lowercase URL-safe slug')
        root = args.project_root.resolve()
        if args.command == 'init':
            if not args.brief:
                raise ValueError('init requires --brief')
            result = initialize(root, args.name, args.brief, args.asset, args.extra, args.rapier, not args.lock_only, args.dynamic_note)
        elif args.command == 'assets':
            result = copy_assets(root, args.asset, args.extra, dynamic_note=args.dynamic_note)
        else:
            if not args.from_stage:
                raise ValueError('advance requires --from-stage')
            result = advance(root, args.name, args.from_stage)
        print(result)
        return 0
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
