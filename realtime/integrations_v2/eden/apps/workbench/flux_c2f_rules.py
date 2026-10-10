# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Coarse-to-fine caption rules and edit instruction.

Caption rules and sanitizer the workbench uses when writing a FLUX prompt.

Only the three things the workbench actually reads are kept:

* :data:`EDIT_INSTRUCTION` — the fixed prefix for every FLUX edit prompt.
* :data:`IMAGE_INSTRUCTIONS` — the caption-writing rules Claude follows.
* :func:`sanitize_caption` — strip forbidden terms from a generated caption.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Edit instruction
# ---------------------------------------------------------------------------

EDIT_INSTRUCTION = (
    "Convert the coarse 3D proxy image into a detailed fine image while preserving "
    "the camera, layout, object positions, rough scale, and scene structure."
)

# ---------------------------------------------------------------------------
# Caption rules
# ---------------------------------------------------------------------------

COMMON_RULES = """Write one concise, self-contained English conditioning caption for coarse-to-fine image editing.

The exact coarse target frame is authoritative for camera, composition, visible object count, placement, relative scale, orientation, depth order, occlusion, paths, boundaries, and functional scene regions. Any original scene description is only a semantic hint and cannot add an unsupported entity, body part, prop, action, text, sign, or background element.

Describe only scene function, neutral camera framing and viewing direction, semantic identities and visible counts, foreground/midground/background layout, relative scale, spacing, depth order, occlusion, boundaries, and functional regions. If identity is uncertain, use a neutral semantic or functional noun such as marker, obstacle, fixture, structure, platform, or barrier.

Never mention colors, color intensity, basic shapes, geometry, proxy construction, materials, substances, surface finish, texture, lighting, shadows, image quality, rendering, or artistic style. Never call the view first-person, third-person, POV, point-of-view, gameplay, player, viewer, or avatar, and never infer hands, arms, or a camera holder. Aim for 45 to 90 words."""

IMAGE_INSTRUCTIONS = COMMON_RULES + """

Use only the attached exact coarse proxy image as visual evidence. Describe the current frame without speculative motion or unseen events."""

# ---------------------------------------------------------------------------
# Caption sanitizer
# ---------------------------------------------------------------------------

TERM_REPLACEMENTS = {
    "away from the viewer": "away from the camera",
    "toward the viewer": "toward the camera",
    "facing the viewer": "facing the camera",
    "away from the player": "away from the camera",
    "toward the player": "toward the camera",
    "facing the player": "facing the camera",
    "first-person gameplay view": "forward-facing camera view",
    "first person gameplay view": "forward-facing camera view",
    "third-person gameplay view": "camera view",
    "third person gameplay view": "camera view",
    "first-person view": "forward-facing camera view",
    "first person view": "forward-facing camera view",
    "third-person view": "camera view",
    "third person view": "camera view",
    "point-of-view": "camera view",
    "point of view": "camera view",
    "ground plane": "ground",
    "box trailer": "cargo trailer",
    "control boxes": "control units",
    "control box": "control unit",
    "boxes": "containers",
    "box": "container",
    "l-shaped": "turning",
    "spheres": "markers",
    "sphere": "marker",
    "cylinders": "fixtures",
    "cylinder": "fixture",
    "cubes": "objects",
    "cube": "object",
    "cuboids": "objects",
    "cuboid": "object",
    "capsules": "figures",
    "capsule": "figure",
    "slabs": "platforms",
    "slab": "platform",
    "discs": "markers",
    "disc": "marker",
    "primitives": "objects",
    "primitive": "object",
}

FORBIDDEN_TERMS = (
    "minimalist", "plain", "simple", "basic", "render", "rendered", "simplified",
    "stylized", "cartoon", "cartoonish", "low-poly", "geometric", "blocky", "boxy",
    "abstract", "flat-shaded", "gamified", "primitive", "proxy", "placeholder",
    "sphere", "spheres", "spherical", "cylinder", "cylinders", "cylindrical",
    "cube", "cubes", "cubic", "cubical", "cuboid", "cuboids", "capsule",
    "capsules", "slab", "slabs", "rectangular", "circular", "square", "triangular",
    "round", "rounded", "conical", "disc", "discs", "l-shaped", "segmented",
    "wood", "wooden", "timber", "metal", "metallic", "steel", "iron", "brass",
    "copper", "concrete", "cement", "masonry", "brick", "glass", "plastic",
    "rubber", "leather", "fabric", "cloth", "ceramic", "tiled", "asphalt",
    "stone", "rocky", "paper", "cardboard", "3d", "matte", "glossy", "smooth",
    "rough", "textured", "texture", "lighting", "shadow", "shadows",
    "first-person", "first person", "third-person", "third person",
    "point-of-view", "point of view", "pov", "gameplay", "viewer", "player",
    "avatar", "red", "orange", "yellow", "green", "blue", "purple", "violet",
    "pink", "brown", "tan", "beige", "white", "black", "gray", "grey", "cyan",
    "teal", "magenta", "gold", "golden", "silver", "bright", "vivid",
    "saturated", "colorful", "colourful", "multicolored", "multi-colored",
    "multicoloured", "multi-coloured", "monochrome",
)


def sanitize_caption(caption: str) -> str:
    """Strip forbidden terms and apply replacements, as the skill's captioner does."""
    for term, replacement in TERM_REPLACEMENTS.items():
        caption = re.sub(rf"\b{re.escape(term)}\b", replacement, caption, flags=re.IGNORECASE)
    for term in FORBIDDEN_TERMS:
        caption = re.sub(rf"\b{re.escape(term)}\b", "", caption, flags=re.IGNORECASE)
    caption = re.sub(r"\ban turning\b", "a turning", caption, flags=re.IGNORECASE)
    caption = re.sub(r",\s*,+", ",", caption)
    caption = re.sub(r"\b(?:and|or)\s+([,.;:])", r"\1", caption, flags=re.IGNORECASE)
    caption = re.sub(r"\s+([,.;:])", r"\1", caption)
    return re.sub(r"\s{2,}", " ", caption).strip()
