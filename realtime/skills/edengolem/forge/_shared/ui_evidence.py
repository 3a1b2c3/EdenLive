"""Per-file provenance for presentation changes that reuse a verified game."""
import os
from pathlib import Path

from _shared.attempts import IGNORED, sha256_file
from _shared.paths import resolve_inside


def tree(root, base, *, shared=False):
    root, base = Path(root).resolve(), Path(base).resolve()
    files = {}
    for directory, names, filenames in os.walk(base):
        names[:] = sorted(n for n in names if n not in IGNORED
                          and not (shared and Path(directory) == root and n == 'runs'))
        if any((Path(directory) / n).is_symlink() for n in names):
            raise ValueError('UI evidence requires copied directories, not symlinks')
        for name in sorted(filenames):
            if name == '.state.json' or name.endswith(('.log', '.pid', '.pyc')):
                continue
            path = resolve_inside(root, Path(directory) / name, 'evidence input')
            files[path.relative_to(base).as_posix()] = sha256_file(path)
    return files


def snapshot(root, run):
    root, run = Path(root).resolve(), Path(run).resolve()
    return {'run': run.relative_to(root).as_posix(), 'files': tree(root, run),
            'shared': tree(root, root, shared=True)}


def changed(before, after):
    return {key: after.get(key) for key in sorted(before.keys() | after.keys())
            if before.get(key) != after.get(key)}


def ui_changes(root, run, source_inputs):
    """Ignore only stage metadata/provenance; include all shared dependency edits."""
    root, run = Path(root).resolve(), Path(run).resolve()
    before = dict(source_inputs['files'])
    after = tree(root, run)
    for mapping in (before, after):
        for name in ('step1.json', 'step2.json', 'step3.json', 'source-artifact.json'):
            mapping.pop(name, None)
    prefix = run.relative_to(root).as_posix()
    result = {f'{prefix}/{p}': digest for p, digest in changed(before, after).items()}
    result.update(changed(source_inputs['shared'], tree(root, root, shared=True)))
    return result
