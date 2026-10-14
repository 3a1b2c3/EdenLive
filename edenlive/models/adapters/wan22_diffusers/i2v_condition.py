"""First-frame conditioning for the Wan I2V transformers (Wan2.1-I2V-14B).

These models do not overwrite latent frame 0 (the Wan2.2 TI2V-5B recipe). Instead the
DiT input is a channel concat ``[noisy latent (16) | first-frame mask (4) | condition
latent (16)]`` = 36 channels with a *scalar* timestep, and the condition latent is the
VAE encoding of a clip whose first frame is the image and whose remaining ``F - 1``
frames are zeros in the ``[-1, 1]`` pixel space (mid-grey, not black). Reference:
``diffusers/pipelines/wan/pipeline_wan_i2v.py::prepare_latents`` and the official
``wan/image2video.py``.

Two encodings of that condition clip are supported:

``masked_video``
    Encode ``[image, zeros x (F-1)]`` as one clip. The Wan VAE is causal and chunked
    (1 + 4k frames per chunk, feature cache across chunks), so latent frames 1: carry
    features leaked from the image. This is what the released models were trained on.
``independent``
    Encode the image alone (1 frame) and an all-zeros clip (F frames), then splice
    ``[image_latent, zeros_latent[1:]]``. Latent frame 0 is bit-identical to
    ``masked_video`` (the first chunk sees only frame 0 either way); frames 1: contain
    no image information. Lets the image and the temporal placeholder be encoded,
    cached and swapped independently.

Everything here is a pure tensor function so it can be unit-tested with a fake encoder
and reused outside the adapter (e.g. latent-level comparisons with a bare VAE).
"""

from __future__ import annotations

from typing import Callable

import torch

FIRST_FRAME_ENCODINGS = ("masked_video", "independent")


def condition_clip(image: torch.Tensor, num_frames: int) -> torch.Tensor:
    """``[B, 3, H, W]`` image -> ``[B, 3, F, H, W]`` clip: image then ``F - 1`` zero frames."""

    if image.ndim != 4:
        raise ValueError(f"condition_clip expects a [B, C, H, W] image, got {tuple(image.shape)}")
    if int(num_frames) < 1:
        raise ValueError(f"num_frames must be >= 1, got {num_frames}")
    batch, channels, height, width = image.shape
    zeros = image.new_zeros(batch, channels, int(num_frames) - 1, height, width)
    return torch.cat([image.unsqueeze(2), zeros], dim=2)


def encode_first_frame_condition(
    encode_video: Callable[[torch.Tensor], torch.Tensor],
    image: torch.Tensor,
    *,
    num_frames: int,
    encoding: str = "masked_video",
) -> torch.Tensor:
    """Return the ``[B, z, T, h, w]`` condition latent for a first-frame image.

    ``encode_video`` maps ``[B, 3, F, H, W]`` pixels in ``[-1, 1]`` to normalized latents
    (the adapter's VAE path). ``num_frames`` is the decoded frame count ``F``.
    """

    if encoding not in FIRST_FRAME_ENCODINGS:
        raise ValueError(f"first_frame_encoding must be one of {FIRST_FRAME_ENCODINGS}, got {encoding!r}")
    if encoding == "masked_video":
        return encode_video(condition_clip(image, num_frames))
    image_latent = encode_video(image.unsqueeze(2))
    zeros_latent = encode_video(torch.zeros_like(condition_clip(image, num_frames)))
    if zeros_latent.shape[2] < 1 or image_latent.shape[2] != 1:
        raise RuntimeError(
            f"unexpected latent frame counts: image {tuple(image_latent.shape)}, zeros {tuple(zeros_latent.shape)}"
        )
    return torch.cat([image_latent, zeros_latent[:, :, 1:]], dim=2)


def first_frame_mask(
    batch_size: int,
    num_frames: int,
    latent_height: int,
    latent_width: int,
    *,
    temporal_scale: int = 4,
    device=None,
    dtype=None,
) -> torch.Tensor:
    """``[B, temporal_scale, T, h, w]`` mask: latent frame 0 is 1, all later frames 0.

    Mirrors ``pipeline_wan_i2v.py`` / ``image2video.py``: a per-decoded-frame mask
    (first frame 1, rest 0) whose first entry is repeated ``temporal_scale`` times so the
    ``F + temporal_scale - 1`` entries fold into ``T = (F - 1) / temporal_scale + 1`` latent
    frames of ``temporal_scale`` channels each.
    """

    num_frames = int(num_frames)
    temporal_scale = int(temporal_scale)
    if (num_frames - 1) % temporal_scale != 0:
        raise ValueError(f"num_frames - 1 must be divisible by temporal_scale ({temporal_scale}), got {num_frames}")
    mask = torch.ones(batch_size, 1, num_frames, latent_height, latent_width, device=device, dtype=dtype)
    mask[:, :, 1:] = 0
    first = mask[:, :, :1].repeat_interleave(temporal_scale, dim=2)
    mask = torch.cat([first, mask[:, :, 1:]], dim=2)
    mask = mask.view(batch_size, -1, temporal_scale, latent_height, latent_width)
    return mask.transpose(1, 2).contiguous()


__all__ = [
    "FIRST_FRAME_ENCODINGS",
    "condition_clip",
    "encode_first_frame_condition",
    "first_frame_mask",
]
