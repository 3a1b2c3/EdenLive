"""Resolve artifact paths without letting standalone checks depend on another tree."""

from pathlib import Path


def resolve_inside(project_root, path, label):
    """Accept relative or absolute paths inside the root, including resolved symlinks."""
    root = Path(project_root).resolve()
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"{label} must stay inside the project root: {path}")
    return resolved
