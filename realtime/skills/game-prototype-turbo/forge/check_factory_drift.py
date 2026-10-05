"""Detect drift between the resource-factory directories and assets/summary.md (fail closed).

Stage 1 hands the agent an extensible, hand-maintained catalog of resource factories. Adding a
factory means dropping a `*Factory.js` file AND editing a catalog linked from assets/summary.md. This
check makes "forgot the edit" loud instead of silent: every factory file on disk must be named
in the catalog, or the run exits non-zero and names the missing entries. It checks; it does not
generate.

Out of scope: a stale entry (a catalogued factory whose file was deleted) is not flagged. Drift
in that direction is a one-line grep and a lesser risk than a factory the agent cannot see.

Contract: --help; non-zero exit + printed reason on drift; no network; pure stdlib.

Usage:
    python forge/check_factory_drift.py                                      # the real assets/ tree
    python forge/check_factory_drift.py --assets DIR --catalog FILE          # a fixture tree

Exit codes:
    0  every factory file is catalogued
    1  at least one factory file is missing from the catalog (drift)
    2  usage or I/O error (missing assets dir or catalog)
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSETS = REPO_ROOT / "assets"
DEFAULT_CATALOG = DEFAULT_ASSETS / "summary.md"


def find_factory_files(assets_root: Path) -> list[str]:
    """Every `*Factory.js` under assets_root, as a repo-relative POSIX path, sorted."""
    repo_root = assets_root.parent
    files = sorted(p for p in assets_root.rglob("*Factory.js") if p.is_file())
    return [p.relative_to(repo_root).as_posix() for p in files]


def missing_entries(catalog_text: str, factory_files: list[str]) -> list[str]:
    """Factory files whose repo-relative path never appears in the catalog text."""
    return [path for path in factory_files if path not in catalog_text]


def read_catalog(catalog_path: Path) -> str:
    """Read the router and only its explicit catalogs/*.md links (one level)."""
    text = catalog_path.read_text(encoding="utf-8")
    linked = sorted(set(re.findall(r'\]\((catalogs/[\w-]+\.md)\)', text)))
    return "\n".join([text] + [
        (catalog_path.parent / link).read_text(encoding="utf-8") for link in linked
    ])


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Fail when a resource factory file is missing from assets/summary.md."
    )
    parser.add_argument(
        "--assets",
        type=Path,
        default=DEFAULT_ASSETS,
        help="directory to scan for *Factory.js (default: assets/)",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=DEFAULT_CATALOG,
        help="the hand-maintained catalog (default: assets/summary.md)",
    )
    args = parser.parse_args(argv)

    assets_root = args.assets
    catalog_path = args.catalog

    if not assets_root.is_dir():
        print(f"error: not a directory: {assets_root}", file=sys.stderr)
        return 2
    if not catalog_path.is_file():
        print(f"error: not a file: {catalog_path}", file=sys.stderr)
        return 2

    try:
        catalog_text = read_catalog(catalog_path)
    except OSError as exc:
        print(f"error: catalog link cannot be read: {exc}", file=sys.stderr)
        return 2
    factory_files = find_factory_files(assets_root)
    missing = missing_entries(catalog_text, factory_files)

    if missing:
        for path in missing:
            print(f"{catalog_path}: missing catalog entry for {path}", file=sys.stderr)
        print(f"{len(missing)} factory file(s) not catalogued", file=sys.stderr)
        return 1

    print(f"{catalog_path}: catalogues all {len(factory_files)} factory files (OK)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
