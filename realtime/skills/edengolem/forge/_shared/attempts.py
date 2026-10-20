"""Small, content-addressed attempt ledger for incremental stage checks.

The ledger deliberately has one format.  A check is reusable only when the
artifact and every declared dependency still has the recorded SHA-256.  This
keeps recovery quick without allowing an old green result to survive an edit.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from functools import lru_cache
from pathlib import Path

FORMAT = "gameblocks-attempts/v1"
IGNORED = {'.git', 'node_modules', 'evidence', '__pycache__', '.pytest_cache'}


class Snapshot(tuple):
    """An (artifacts, dependencies) pair with an optional reproducible check binding."""
    def __new__(cls, artifacts, dependencies, binding=None):
        value = super().__new__(cls, (artifacts, dependencies))
        value.binding = binding
        return value


def path_hash(root: Path, path: Path) -> str:
    """Hash files or directory contents, including additions and deletions.

    The project-root digest covers shared sources; each run has its own digest.
    Evidence/state/logs are outputs, npm versions are bound by the lockfile.
    """
    if path.is_file():
        return sha256_file(path)
    if not path.exists():
        return hashlib.sha256(b'gameblocks:missing').hexdigest()
    rows = []
    for directory, names, files in os.walk(path):
        names[:] = sorted(n for n in names if n not in IGNORED
                          and not (Path(directory) == root and n == 'runs'))
        for name in sorted(files):
            if name == '.state.json' or name.endswith(('.log', '.pid', '.pyc')):
                continue
            item = _inside(root, Path(directory) / name)
            rows.append([str((Path(directory) / name).relative_to(path)), sha256_file(item)])
        # Symlinks must not hide mutable runtime dependencies from the digest.
        if any((Path(directory) / n).is_symlink() for n in names):
            raise ValueError('hash inputs must contain copied directories, not directory symlinks')
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def _root(path: Path | str) -> Path:
    return Path(path).resolve()


def _inside(root: Path, path: Path | str) -> Path:
    value = Path(path)
    if not value.is_absolute():
        value = root / value
    value = value.resolve()
    if not value.is_relative_to(root):
        raise ValueError(f"path must stay inside project root: {value}")
    return value


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_hashes(root: Path | str, paths) -> dict[str, str]:
    base = _root(root)
    result = {}
    for item in paths:
        path = _inside(base, item)
        result[path.relative_to(base).as_posix()] = path_hash(base, path)
    return dict(sorted(result.items()))


def ledger_path(root: Path | str) -> Path:
    return _root(root) / "evidence" / "attempts.json"


def empty_ledger() -> dict:
    return {"format": FORMAT, "attempts": []}


@lru_cache(maxsize=1)
def _validator():
    from jsonschema import Draft7Validator
    schema = Path(__file__).resolve().parents[2] / 'docs/specs/attempt.schema.json'
    return Draft7Validator(json.loads(schema.read_text()))


def _validate(data):
    error = next(_validator().iter_errors(data), None)
    if error:
        raise ValueError(f'invalid attempt ledger: {error.message}')


def load_ledger(root: Path | str) -> dict:
    path = ledger_path(root)
    if not path.is_file():
        return empty_ledger()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("format") != FORMAT or not isinstance(data.get("attempts"), list):
        raise ValueError(f"invalid attempt ledger format: {path}")
    _validate(data)
    return data


def save_ledger(root: Path | str, data: dict) -> Path:
    _validate(data)
    path = ledger_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)
    return path


def record_attempt(root: Path | str, *, check: str, artifact, dependencies=(), result: str,
                   affected=(), failure=None, cause=None, edit=None, retest=None,
                   run_id=None, input_hashes=None, binding=None) -> dict:
    if result not in {"passed", "failed", "not_evaluated"}:
        raise ValueError("result must be passed, failed or not_evaluated")
    if not isinstance(check, str) or not check.strip():
        raise ValueError("check is required")
    base = _root(root)
    artifact_paths = [artifact] if isinstance(artifact, (str, Path)) else list(artifact)
    dependency_paths = list(dependencies)
    entry = {
        "run_id": run_id or f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}",
        "check": check,
        "artifact": input_hashes[0] if input_hashes else file_hashes(base, artifact_paths),
        "dependencies": input_hashes[1] if input_hashes else file_hashes(base, dependency_paths),
        "result": result,
        "affected": sorted(set(affected)),
        "failure": failure,
        "cause": cause,
        "edit": edit,
        "retest": retest,
    }
    if binding is not None:
        entry['binding'] = binding
    data = load_ledger(base)
    data["attempts"].append(entry)
    save_ledger(base, data)
    return entry


def stage_snapshot(root, run, extra=(), *, kind=None, settings=None):
    """Hash the selected check closure, or the whole artifact for manual evidence."""
    if kind:
        from _shared.check_dependencies import snapshot
        try:
            return snapshot(root, run, extra, kind=kind, settings=settings)
        except (OSError, ValueError, TypeError):
            pass  # Malformed metadata must still produce a failed retained attempt.
    from _shared.run_contract import read_meta
    base = _root(root)
    run_path = _inside(base, run)
    artifacts = [run_path, *extra]
    try:
        meta = read_meta(run_path)
    except (OSError, ValueError):
        meta = {}  # Malformed metadata must still produce a failed attempt.
    if isinstance(meta.get('brief'), str):
        artifacts.append(run_path / meta['brief'])
    return Snapshot(file_hashes(base, artifacts), file_hashes(base, ['.']))


def record_stage(root, run, check, report_path, report, inputs):
    path = _inside(_root(root), report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    artifacts = {**inputs[0], **file_hashes(root, [path])}
    errors = list(report.get('errors', []))
    errors.extend(s['reason'] for s in report.get('scenarios', []) if s.get('reason'))
    if report['functional'].get('reason'):
        errors.append(report['functional']['reason'])
    return record_attempt(root, check=check, artifact=[], input_hashes=(artifacts, inputs[1]),
                          binding=({'inputs': [inputs[0], inputs[1]], 'report': path.relative_to(_root(root)).as_posix(), **inputs.binding}
                                   if getattr(inputs, 'binding', None) else None),
                          result=report['functional']['status'], affected=[Path(run).name],
                          failure='; '.join(errors) or None,
                          retest=f'rerun {check} against the current artifact')


def current_hashes(root: Path | str, entry: dict) -> tuple[dict, dict]:
    base = _root(root)
    return (
        file_hashes(base, entry.get("artifact", {}).keys()),
        file_hashes(base, entry.get("dependencies", {}).keys()),
    )


def evidence_valid(root: Path | str, entry: dict) -> bool:
    try:
        artifact, dependencies = current_hashes(root, entry)
        if entry.get('binding'):
            from _shared.check_dependencies import snapshot
            binding = dict(entry['binding'])
            expected = binding.pop('inputs')
            binding.pop('report', None)
            current = snapshot(root, binding['run'], binding['extra'], kind=binding['kind'], settings=binding['settings'])
            if current.binding != binding or list(current) != expected:
                return False
    except (OSError, ValueError, TypeError, KeyError):
        return False
    return artifact == entry.get("artifact") and dependencies == entry.get("dependencies")


def reusable(root: Path | str, check: str, *, artifact=None, dependencies=None) -> dict | None:
    """Return the newest still-valid result for ``check`` or ``None``.

    An optional artifact/dependency list narrows reuse to the current inputs;
    omitted lists reuse the exact paths recorded by the candidate entry.
    """
    data = load_ledger(root)
    base = _root(root)
    for entry in reversed(data["attempts"]):
        if entry.get("check") != check:
            continue
        # A newer failure or stale attempt must never resurrect an older pass.
        if not evidence_valid(base, entry):
            return None
        if artifact is not None:
            scoped_run = entry.get('binding', {}).get('run')
            if not (scoped_run and isinstance(artifact, (str, Path)) and _inside(base, artifact) == base / scoped_run):
                requested = file_hashes(base, [artifact] if isinstance(artifact, (str, Path)) else artifact)
                if any(entry['artifact'].get(path) != digest for path, digest in requested.items()):
                    continue
        if dependencies is not None:
            requested = file_hashes(base, dependencies)
            if any(entry['dependencies'].get(path) != digest for path, digest in requested.items()):
                continue
        return entry
    return None
