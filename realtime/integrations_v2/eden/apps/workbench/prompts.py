# SPDX-License-Identifier: Apache-2.0
"""Prompts the workbench hands to ``claude -p``."""

from __future__ import annotations

import importlib.util
import os
from functools import cache
from pathlib import Path
from types import ModuleType

CAPTION_SCRIPT = Path(os.environ.get("EDEN_FLUX_CAPTION_SCRIPT", ""))
"""The coarse-to-fine skill's caption script.

Set ``EDEN_FLUX_CAPTION_SCRIPT`` to it. There is no default: the script lives
in the FLUX fine-tuning repo, which is not vendored here.
"""


@cache
def caption_rules() -> ModuleType:
    """The coarse-to-fine skill's caption script, for its rules and sanitizer.

    Its ``IMAGE_INSTRUCTIONS`` is what the LoRA's training captions were
    written to, so the caption Claude writes follows the same text verbatim.
    """
    if not str(CAPTION_SCRIPT):
        raise RuntimeError(
            "set EDEN_FLUX_CAPTION_SCRIPT to the coarse-to-fine skill's "
            "refine_prompts_comet.py"
        )
    spec = importlib.util.spec_from_file_location("flux_c2f_captions", CAPTION_SCRIPT)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import {CAPTION_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def game_prompt(request: str, *, skill: Path, project: Path) -> str:
    """Ask for one complete GamePrototypeTurbo build, unattended."""
    return f"""You are running unattended inside a web workbench; nobody will answer questions, so never stop to ask.

Build a new browser game prototype with the GamePrototypeTurbo skill at {skill}.
Read {skill}/SKILL.md first and follow it end to end for a new game: intake, then scene, behavior and acceptance, running every gate and review it requires.

Game request from the user:
<request>
{request.strip()}
</request>

- The output project root is {project} (it exists and is empty). Pass it as --project-root; skill tools stay in {skill}.
- If part of the request is outside the skill's scope, adapt it to the closest in-scope game instead of stopping, and say what you changed.
- Make every design decision yourself. Keep the game small so it reaches acceptance.
- Finish only when {project}/.state.json shows acceptance passed, or when you are certain it cannot pass.

End with a short plain-text summary: the game title, controls, and anything you could not finish."""


def caption_prompt(image: Path) -> str:
    """Ask for one coarse-to-fine caption of ``image``, in the skill's words."""
    rules = caption_rules().IMAGE_INSTRUCTIONS
    return f"""Read the image file {image} (a coarse 3D proxy frame) and caption it.

{rules}

Reply with the caption text only: one paragraph, no quotes, no preamble, no markdown."""


def sanitize_caption(text: str) -> str:
    """Strip the skill's forbidden terms, as its own captioner does."""
    text = " ".join(text.strip().strip('"').split())
    return caption_rules().sanitize_caption(text)
