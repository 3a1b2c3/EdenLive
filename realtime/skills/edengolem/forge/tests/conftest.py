"""Browser tests share dependency detection; pure checks need no browser installation."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forge"))


def pytest_addoption(parser):
    parser.addoption("--require-browser", action="store_true",
                     help="fail instead of skipping browser tests when dependencies are missing")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "slow: boots a real browser; skips when Playwright, Chromium or local three is unavailable. "
        'Deselect with -m "not slow".',
    )


@pytest.fixture(scope="session")
def browser_dependencies(request):
    def unavailable(reason):
        if request.config.getoption("--require-browser"):
            pytest.fail(reason, pytrace=False)
        pytest.skip(reason)

    try:
        import playwright.sync_api  # noqa: F401
    except ImportError:
        unavailable("Playwright is unavailable; install requirements-browser.txt")
    from check_step1 import find_chromium

    chromium = find_chromium()
    if not chromium or not Path(chromium).is_file():
        unavailable("Chromium is unavailable; run python -m playwright install chromium or set GBDATA_CHROMIUM")
    if not (ROOT / "node_modules/three/build/three.module.js").is_file():
        unavailable("local three is unavailable; run npm ci")
    return chromium


@pytest.fixture(autouse=True)
def check_browser_dependencies(request):
    if request.node.get_closest_marker("slow"):
        request.getfixturevalue("browser_dependencies")
