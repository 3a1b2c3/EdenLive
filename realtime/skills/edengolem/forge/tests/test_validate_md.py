"""Tests for forge/validate_md.py (the fail-loud writing-contract lint)."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = REPO_ROOT / "forge" / "validate_md.py"


def run_validator(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), str(root)],
        capture_output=True,
        text=True,
    )


def test_validate_md_reports_clean() -> None:
    result = run_validator(REPO_ROOT)
    assert result.returncode == 0, result.stderr


def test_validate_md_flags_emoji(tmp_path) -> None:
    (tmp_path / "bad.md").write_text("# bad\n\U0001F600 hello\n", encoding="utf-8")
    result = run_validator(tmp_path)
    assert result.returncode == 1, result.stdout
    assert "bad.md" in result.stderr


def test_validate_md_flags_missing_backtick_path(tmp_path) -> None:
    """A repo path cited as inline code must exist: this is what a rename breaks."""
    (tmp_path / "bad.md").write_text(
        "# bad\n\nRead `assets/game_briefs/x.brief.json` for the format.\n",
        encoding="utf-8",
    )
    result = run_validator(tmp_path)
    assert result.returncode == 1, result.stdout
    assert "broken backtick path" in result.stderr
    assert "assets/game_briefs/x.brief.json" in result.stderr


def test_validate_md_accepts_existing_backtick_path(tmp_path) -> None:
    """The check must not fire on a path that does exist, nor on prose in backticks."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "summary.md").write_text("# summary\n", encoding="utf-8")
    (tmp_path / "good.md").write_text(
        "# good\n\n"
        "Read `assets/summary.md` first. Set `player_modality` to `avatar`.\n"
        "A glob that matches is fine: `assets/*.md`.\n",
        encoding="utf-8",
    )
    result = run_validator(tmp_path)
    assert result.returncode == 0, result.stderr


def test_validate_md_flags_glob_in_renamed_directory(tmp_path) -> None:
    """Regression: a glob citation must not hide a renamed directory.

    `assets/game_briefs/*.brief.json` survived the rename to game-briefs because an
    earlier version of this check skipped any path containing '*'.
    """
    (tmp_path / "assets" / "game-briefs").mkdir(parents=True)
    (tmp_path / "assets" / "game-briefs" / "x.brief.json").write_text("{}", encoding="utf-8")
    (tmp_path / "stale.md").write_text(
        "# stale\n\nBriefs live in `assets/game_briefs/*.brief.json`.\n",
        encoding="utf-8",
    )
    result = run_validator(tmp_path)
    assert result.returncode == 1, result.stdout
    assert "assets/game_briefs/*.brief.json" in result.stderr


def test_validate_md_flags_glob_matching_nothing(tmp_path) -> None:
    """An existing directory whose glob matches no file is still a dead citation."""
    (tmp_path / "assets" / "game-briefs").mkdir(parents=True)
    (tmp_path / "empty.md").write_text(
        "# empty\n\nBriefs live in `assets/game-briefs/*.brief.json`.\n",
        encoding="utf-8",
    )
    result = run_validator(tmp_path)
    assert result.returncode == 1, result.stdout
    assert "matches nothing" in result.stderr