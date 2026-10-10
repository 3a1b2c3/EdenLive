# SPDX-License-Identifier: Apache-2.0
"""Prompts the workbench hands to ``claude -p``."""

from __future__ import annotations

import re
from pathlib import Path

from .flux_c2f_rules import IMAGE_INSTRUCTIONS, sanitize_caption as _sanitize

CAPTION_STYLES = {
    "realistic": (
        "Realistic",
        "Naturalistic photographic detail, believable surfaces, and restrained lighting.",
    ),
    "cinematic": (
        "Cinematic",
        "Filmic contrast, atmospheric depth, dramatic but believable lighting, and rich color grading.",
    ),
    "storybook": (
        "Storybook",
        "Hand-painted illustration, expressive brushwork, warm color harmony, and gentle lighting.",
    ),
    "animation": (
        "Animated film",
        "Polished animated-film design, cohesive colors, tactile surfaces, and soft lighting.",
    ),
    "anime": (
        "Anime",
        "Clean linework, controlled cel shading, expressive color, and crisp highlights.",
    ),
}


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



def revise_prompt(request: str, history: list[tuple[str, str]], *, skill: Path, project: Path) -> str:
    """Ask for one revision of the game in ``project``, unattended.

    ``history`` is the conversation so far as ``(role, text)`` pairs, oldest
    first, so a follow-up such as "make it faster" has the game it refers to.
    """
    earlier = "\n".join(f"{role}: {' '.join(text.split())}" for role, text in history) or "(none)"
    return f"""You are running unattended inside a web workbench; nobody will answer questions, so never stop to ask.

The game in {project} was built with the GamePrototypeTurbo skill at {skill}. The user wants to change it.
Read {skill}/SKILL.md, then follow its "Change a passed game" workflow ({skill}/grimoire/build/revisions.md): copy the affected run to a new run, record the revision in {project}/.state.json, make the change there, and recheck what it affects.
If the game never passed acceptance, continue its unfinished stage with the change folded in instead.

Conversation so far:
<history>
{earlier}
</history>

Change requested now:
<request>
{request.strip()}
</request>

- Keep {project} as the output root; skill tools stay in {skill}. Leave earlier runs in place.
- Make every design decision yourself. Keep the change small enough to verify.

End with two things: a line `RUN: <path of the revised run, relative to {project}>`, then a short plain-text summary of what changed and anything you could not finish."""


def caption_prompt(image: Path, style: str = "realistic") -> str:
    """Describe the exact proxy frame, then add the selected appearance style."""
    label, guidance = CAPTION_STYLES[style]
    return f"""Read the image file {image} (a coarse 3D proxy frame) and caption it.

{IMAGE_INSTRUCTIONS}

Write two parts. SCENE must follow every rule above and describe only what is visible in the image. STYLE is the only exception to the ban on appearance words: describe how the visible scene should look in the {label} style. Use this direction: {guidance} In STYLE, describe only color, lighting, and surface treatment of elements already named in SCENE. Do not introduce new objects, characters, scenery, text, or actions. Preserve the exact camera and layout.

Reply in English with exactly these two lines, no preamble or markdown:
SCENE: <45-90 words about the exact image composition>
STYLE: <one concise sentence about the {label} appearance of visible elements>"""


def sanitize_caption(text: str, style: str = "realistic") -> str:
    """Keep scene geometry neutral while retaining Claude's selected style."""
    match = re.search(r"(?im)^\s*STYLE:\s*", text)
    scene = text[:match.start()] if match else text
    scene = re.sub(r"^\s*SCENE:\s*", "", scene, flags=re.IGNORECASE)
    scene = _sanitize(" ".join(scene.strip().strip('"').split()))
    appearance = " ".join(text[match.end():].strip().strip('"').splitlines()[0].split()) if match else ""
    appearance = appearance[:300].strip() or CAPTION_STYLES[style][1]
    return f"{scene} Visual style: {appearance}"
