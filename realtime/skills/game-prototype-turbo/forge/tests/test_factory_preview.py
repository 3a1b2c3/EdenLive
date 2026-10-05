"""Exercise preview controls against the rendered visual, including paused rebuilds.

The preview drives the simplified factories: every family exposes a small pose
surface (api motions plus action tables), the character keeps its loadout-driven
hand actions, and resets restore the ground pose without moving the camera.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forge"))

from check_step1 import SOFTWARE_GL_ARGS, serving  # noqa: E402


def _canvas_frame(page):
    page.evaluate("""() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)))""")
    return page.locator("#canvas").screenshot()


@pytest.mark.slow
def test_paused_character_rebuild_and_reset_match_selected_motion(browser_dependencies):
    from playwright.sync_api import sync_playwright

    with serving(ROOT / "assets/examples", "assets/examples") as base, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_dependencies, headless=True, args=SOFTWARE_GL_ARGS)
        try:
            page = browser.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=1)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "/assets/examples/factory-preview/")
            page.wait_for_selector('body[data-ready="true"]')
            page.locator("#pause").click()
            page.locator("#motion").select_option("walk")
            walk = _canvas_frame(page)
            page.locator("#resolved > summary").click()
            page.locator("#apply").click()
            assert _canvas_frame(page) == walk, "rebuild must retain the selected paused pose"

            page.locator("#shape-height").fill("3")
            assert json.loads(page.locator("#params").input_value())["height"] == 3
            # Walk is periodic and pose time resets on a motion change, so sample
            # both comparison frames at the same clock position (elapsed = 0).
            page.locator("#motion").select_option("idle")
            page.locator("#motion").select_option("walk")
            resized = _canvas_frame(page)
            assert resized != walk, "shape controls must change the rendered model"
            page.locator("#motion").select_option("idle")
            idle = _canvas_frame(page)
            page.locator("#motion").select_option("walk")
            assert _canvas_frame(page) == resized, "shape edits must retain walk"

            # The simplified normalizer tolerates junk values, so an unknown preset
            # is the deterministic way to trip the error path.
            params = json.loads(page.locator("#params").input_value())
            params["preset"] = "missing"
            page.locator("#params").fill(json.dumps(params))
            page.locator("#apply").click()
            assert page.locator("#error").is_visible()
            assert _canvas_frame(page) == resized, "invalid options must keep the current model"

            page.locator("#reset").click()
            assert _canvas_frame(page) == idle
            # The simplified character resets to its idle pose while the selection
            # keeps the last picked motion.
            assert page.locator("#motion").input_value() == "walk"
            assert page.locator("#pause").get_attribute("aria-pressed") == "true"
            assert not errors
        finally:
            browser.close()


@pytest.mark.slow
def test_workshop_discovers_current_actions_and_preserves_reset_render(browser_dependencies):
    from playwright.sync_api import sync_playwright

    with serving(ROOT / "assets/examples", "assets/examples") as base, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_dependencies, headless=True, args=SOFTWARE_GL_ARGS)
        try:
            page = browser.new_page(viewport={"width": 1000, "height": 740}, device_scale_factor=1)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("response", lambda response: errors.append(f"{response.status}: {response.url}")
                    if response.status >= 400 else None)
            page.goto(base + "/assets/examples/factory-preview/")
            page.wait_for_selector('body[data-ready="true"]')
            page.locator("#pause").click()

            # The current loadout controls action availability, including the support hand.
            page.locator("#loadout-right").select_option("bow")
            assert page.locator('#motion option[value="right:draw"]').count() == 1
            page.locator("#loadout-left").select_option("roundShield")
            assert page.locator('#motion option[value="right:draw"]').count() == 0
            page.locator("#loadout-left").select_option("")
            assert page.locator('#motion option[value="right:loose"]').count() == 1

            # The simplified set keeps one small action surface per family; the old
            # crouch / graze / glide / dart / slalom demos are gone.
            cases = [
                ("equipment", "bow", {"draw", "loose"}),
                ("quadruped", None, {"pounce", "charge", "death"}),
                ("bird", None, {"pounce", "charge", "death"}),
                ("fish", None, {"pounce", "charge", "death"}),
                ("fantasy", "wyvern", {"pounce", "charge", "death"}),
                ("pickup", "gem", {"idle", "appear", "collect"}),
                ("mechanism", "gate", {"closed", "open", "operate"}),
                ("rock", "boulder", {"still", "rotate", "impact", "settle", "scatter", "pulse"}),
                ("vehicle", None, {"drive"}),
                ("aircraft", "lightFighter", {"bank", "gearUp", "gearDown", "fire", "launch"}),
                ("house", None, set()), ("building", None, set()),
                ("tree", None, {"wind"}), ("train", None, set()),
            ]
            for family, preset, required in cases:
                page.locator("#family").select_option(family)
                if preset:
                    page.locator("#preset").select_option(preset)
                available = set(page.locator("#motion option").evaluate_all("nodes => nodes.map(n => n.value)"))
                assert required <= available, (family, available)
                assert page.locator("#error").is_hidden(), page.locator("#error").text_content()
                assert page.locator("#shape input, #shape select").count() > 0
                if required:
                    page.locator("#motion").select_option(sorted(required)[0])
                    page.locator("#reset").click()
                    assert page.locator("#error").is_hidden(), "reset must keep the family valid"

            # Check actual rendered state changes and repeatable reset through public UI.
            page.locator("#family").select_option("mechanism")
            page.locator("#preset").select_option("gate")
            closed = _canvas_frame(page)
            page.locator("#motion").select_option("open")
            assert _canvas_frame(page) != closed, "open must move the rendered gate"
            page.locator("#reset").click()
            assert _canvas_frame(page) == closed
            page.locator("#family").select_option("aircraft")
            page.locator("#preset").select_option("glider")
            assert page.locator('#motion option[value="fire"]').count() == 0
            assert page.locator('#motion option[value="launch"]').count() == 0
            assert not errors
        finally:
            browser.close()