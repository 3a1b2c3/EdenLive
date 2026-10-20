"""Missing optional browser dependencies must not break pure repository checks."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# The fresh process prevents the host's already-imported Playwright from hiding
# the missing-package condition. No installed packages or browser files change.
RUN_PYTEST = """
import importlib.abc
import sys

missing = sys.argv.pop(1)
if missing == 'playwright':
    class MissingPlaywright(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname == 'playwright' or fullname.startswith('playwright.'):
                raise ModuleNotFoundError('Playwright deliberately unavailable', name=fullname)
    sys.meta_path.insert(0, MissingPlaywright())

import pytest
raise SystemExit(pytest.main(sys.argv[1:]))
"""


@pytest.mark.parametrize("missing", ["playwright", "chromium"])
@pytest.mark.parametrize("mode", ["optional", "required", "deselected"])
def test_missing_browser_dependency_has_explicit_test_outcome(tmp_path, missing, mode):
    args = [
        sys.executable, "-c", RUN_PYTEST, missing, "-q", "-rs", "-p", "no:cacheprovider",
        "forge/tests/test_check_step1.py::test_find_chromium_honours_the_environment",
        "forge/tests/test_menu_playthrough.py::test_menu_board_supports_real_selection_and_replay",
    ]
    if mode == "required":
        args.append("--require-browser")
    elif mode == "deselected":
        args.extend(["-m", "not slow"])
    env = {**os.environ, "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1", "PYTEST_ADDOPTS": ""}
    if missing == "chromium":
        env["GBDATA_CHROMIUM"] = str(tmp_path / "missing-chromium")
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    output = result.stdout + result.stderr
    assert "1 passed" in output, output
    if mode == "required":
        assert result.returncode == 1, output
        assert "1 error" in output, output
        assert "unavailable" in output, output
    else:
        assert result.returncode == 0, output
        assert ("1 skipped" if mode == "optional" else "1 deselected") in output, output
