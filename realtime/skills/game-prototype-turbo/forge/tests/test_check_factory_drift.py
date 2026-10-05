"""Tests for forge/check_factory_drift.py: a passing fixture + failing mutations.

Contract: adding a resource factory means dropping a `*Factory.js` file AND editing its entry
in assets/summary.md. The check makes a forgotten edit loud (non-zero exit + names the file)
instead of silent. The fixtures build a tiny assets tree, so the test never touches the real
catalog; one test does run against the live tree to assert it currently has no drift.
Run from the repo root with:
    make lint               # or: python -m pytest forge/tests/ -q
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECK = REPO_ROOT / "forge" / "check_factory_drift.py"


def build_tree(tmp_path: Path) -> tuple[Path, Path]:
    """A minimal assets tree: two factory files, both catalogued."""
    assets = tmp_path / "assets"
    obj_factory = assets / "world" / "object" / "factory"
    env = assets / "world" / "environment"
    obj_factory.mkdir(parents=True)
    env.mkdir(parents=True)

    (obj_factory / "GreyboxKitFactory.js").write_text("// a factory\n", encoding="utf-8")
    (env / "TerrainMeshFactory.js").write_text("// a factory\n", encoding="utf-8")

    summary = assets / "summary.md"
    summary.write_text(
        "### `assets/world/object/factory/GreyboxKitFactory.js`\n"
        "### `assets/world/environment/TerrainMeshFactory.js`\n",
        encoding="utf-8",
    )
    return assets, summary


def run_check(assets: Path, summary: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CHECK), "--assets", str(assets), "--catalog", str(summary)],
        capture_output=True,
        text=True,
    )


def test_all_factory_files_catalogued_passes(tmp_path) -> None:
    assets, summary = build_tree(tmp_path)
    result = run_check(assets, summary)
    assert result.returncode == 0, result.stderr


def test_split_catalog_requires_reachable_entries(tmp_path):
    assets, summary = build_tree(tmp_path)
    content = summary.read_text()
    catalogs = assets / 'catalogs'
    catalogs.mkdir()
    (catalogs / 'world.md').write_text(content)
    summary.write_text('[World](catalogs/world.md)\n')
    assert run_check(assets, summary).returncode == 0
    # An unrelated document must not hide a missing entry in the linked catalog.
    (assets / 'unrelated.md').write_text(content)
    (catalogs / 'world.md').write_text('# No entries\n')
    result = run_check(assets, summary)
    assert result.returncode == 1 and 'GreyboxKitFactory' in result.stderr
    (catalogs / 'world.md').unlink()
    result = run_check(assets, summary)
    assert result.returncode == 2 and 'catalog link' in result.stderr


def test_uncatalogued_factory_fails_loud(tmp_path) -> None:
    assets, summary = build_tree(tmp_path)
    # failing mutation: a factory file added without its catalog entry
    (assets / "world" / "object" / "factory" / "SnowPropFactory.js").write_text(
        "// a factory\n", encoding="utf-8"
    )
    result = run_check(assets, summary)
    assert result.returncode == 1, result.stderr
    assert "SnowPropFactory.js" in result.stderr


def test_missing_assets_dir_is_usage_error(tmp_path) -> None:
    _, summary = build_tree(tmp_path)
    result = run_check(tmp_path / "no-such-dir", summary)
    assert result.returncode == 2


def test_missing_catalog_is_usage_error(tmp_path) -> None:
    assets, _ = build_tree(tmp_path)
    result = run_check(assets, tmp_path / "no-summary.md")
    assert result.returncode == 2


def test_real_catalog_has_no_drift() -> None:
    """The live assets/ tree must pass the check right now — a passing fixture is not enough."""
    result = subprocess.run(
        [sys.executable, str(CHECK)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
