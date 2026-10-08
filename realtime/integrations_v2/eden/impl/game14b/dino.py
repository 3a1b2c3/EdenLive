# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Frozen proxy-DINO (DINOv3 ViT-L/16) control encoder.

Ported from the reference recipe's ``extern/proxy_dino/encoder.py`` so the
inference numerics match: bilinear+antialias resize to 288x512, ImageNet
normalization, bf16 autocast backbone, 2x2 patch grouping, fp32 projection,
L2 normalization, then a trilinear resample onto the DiT's latent grid.

Per-frame independence is what makes the overlap in
:mod:`eden.apps.game2v.session` sound: a chunk's features depend only on
that chunk's rendered frames, so the encode can start the moment the render
finishes and be awaited just before the consuming chunk denoises.

Acceleration notes (measured shapes, not guesses): the DINO sequence is
18x32 = 576 patch tokens, far too short for sequence parallelism to pay for
its collectives — the recipe's own launch keeps DINO replicated. What does
pay off is that every chunk presents an identical input shape
``[len_t, 3, 288, 512]``, so ``torch.compile`` and CUDA-graph replay both
see one static shape. Rank 0 encodes and broadcasts, which keeps the cost
off the other ranks entirely.
"""

from __future__ import annotations

import os
import time
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field

import torch
import torch.nn.functional as F
from loguru import logger
from torch import Tensor, nn

from flashdreams.infra.config import InstantiateConfig

# ImageNet statistics, as used by the reference encoder.
DINOV3_IMAGE_MEAN = (0.485, 0.456, 0.406)
DINOV3_IMAGE_STD = (0.229, 0.224, 0.225)


def _resolve_projection_path(path: str) -> str:
    """Resolve a projection checkpoint path against ``HF_HOME``.

    Absolute paths pass through. Relative paths are read out of the offline HF
    cache root, so a config can name a checkpoint inside that cache instead of
    spelling out a host-specific prefix.
    """
    if os.path.isabs(path):
        return path
    hf_home = os.environ.get("HF_HOME")
    if not hf_home:
        raise ValueError(
            f"proxy-DINO projection path {path!r} is relative but HF_HOME is unset; "
            "set HF_HOME or give an absolute path."
        )
    return os.path.join(hf_home, path)


def extract_shared_encoder_state_dict(
    state: dict[str, Tensor],
) -> dict[str, Tensor]:
    """Pull the shared encoder tensors out of the training checkpoint.

    The checkpoint is written by the reference trainer, so keys carry a
    ``model.module.``/``model.``/``module.`` prefix and an ``encoder.``
    scope above the three submodules we keep.
    """
    encoder_state: dict[str, Tensor] = {}
    for raw_key, value in state.items():
        key = raw_key
        for prefix in ("model.module.", "model.", "module."):
            if key.startswith(prefix):
                key = key[len(prefix) :]
                break
        if key.startswith("encoder."):
            key = key[len("encoder.") :]
        if key.startswith(("backbone.", "global_projection.", "patch_projection.")):
            encoder_state[key] = value
    if not encoder_state:
        raise ValueError("checkpoint does not contain a shared DINOv3 encoder")
    return encoder_state


class ProxyDinoEncoder(nn.Module):
    """Frozen DINOv3 backbone plus the finetuned patch projection."""

    def __init__(
        self,
        backbone: nn.Module,
        *,
        projection_dim: int = 1024,
        patchify_factor: int = 2,
    ) -> None:
        super().__init__()
        self.backbone = backbone
        self.patchify_factor = int(patchify_factor)
        if self.patchify_factor < 1:
            raise ValueError("patchify_factor must be positive")
        hidden_size = int(backbone.config.hidden_size)
        self.global_projection = nn.Linear(hidden_size, int(projection_dim))
        self.patch_projection = nn.Linear(
            hidden_size * self.patchify_factor**2, int(projection_dim)
        )
        self.feature_dim = int(projection_dim)

    @property
    def patch_size(self) -> int:
        return int(self.backbone.config.patch_size)

    @property
    def num_register_tokens(self) -> int:
        return int(getattr(self.backbone.config, "num_register_tokens", 0))

    def _patch_grid(self, tokens: Tensor, image_shape: tuple[int, int]) -> Tensor:
        """Group ``[L, D]`` patch tokens into a ``[h/f, w/f, D*f*f]`` grid."""
        height = int(image_shape[0]) // self.patch_size
        width = int(image_shape[1]) // self.patch_size
        factor = self.patchify_factor
        if height % factor or width % factor:
            raise ValueError(
                f"DINO patch grid {height}x{width} is not divisible by "
                f"patchify_factor={factor}"
            )
        patch_start = 1 + self.num_register_tokens
        patch_tokens = tokens[patch_start : patch_start + height * width]
        if int(patch_tokens.shape[0]) != height * width:
            raise ValueError(
                "DINO output does not contain the expected number of patch tokens"
            )
        patch_grid = patch_tokens.reshape(height, width, -1)
        patch_grid = patch_grid.reshape(
            height // factor, factor, width // factor, factor, -1
        )
        return patch_grid.permute(0, 2, 1, 3, 4).flatten(2)

    @torch.no_grad()
    def forward(
        self,
        images: Tensor,
        *,
        image_size: tuple[int, int] = (288, 512),
    ) -> Tensor:
        """Encode ``[N, 3, H, W]`` RGB in ``[0, 1]`` to ``[N, C, h, w]``."""
        if images.ndim != 4 or int(images.shape[1]) != 3:
            raise ValueError(
                f"DINO control images must be [N,3,H,W], got {tuple(images.shape)}"
            )
        pixel_values = F.interpolate(
            images.float(),
            size=tuple(image_size),
            mode="bilinear",
            align_corners=False,
            antialias=True,
        )
        mean = pixel_values.new_tensor(DINOV3_IMAGE_MEAN).view(1, 3, 1, 1)
        std = pixel_values.new_tensor(DINOV3_IMAGE_STD).view(1, 3, 1, 1)
        pixel_values = (pixel_values - mean) / std
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=pixel_values.is_cuda):
            output = self.backbone(pixel_values=pixel_values)
        grids = torch.stack(
            [
                self._patch_grid(tokens, tuple(pixel_values.shape[-2:]))
                for tokens in output.last_hidden_state
            ]
        )
        # The projection stays in fp32 even under the bf16 backbone autocast,
        # matching the reference encoder.
        projected = F.normalize(self.patch_projection(grids.float()), p=2, dim=-1)
        return projected.permute(0, 3, 1, 2).contiguous()


@dataclass
class ProxyDinoEncoderConfig(InstantiateConfig):
    """Config for the frozen proxy-DINO control encoder."""

    _target: type["ProxyDinoControlEncoder"] = field(
        default_factory=lambda: ProxyDinoControlEncoder
    )

    backbone_repo: str = ""
    """Local directory holding the DINOv3 backbone (``model.safetensors`` +
    ``config.json``), read by ``AutoModel.from_pretrained``. The Game2V apps
    pass the path from their pipeline YAML; empty is rejected at construction
    rather than resolved to a built-in location."""

    projection_path: str = ""
    """Finetuned projection checkpoint. A ``.safetensors`` file is read flat;
    relative paths still resolve under ``HF_HOME``. The Game2V apps pass the
    path from their pipeline YAML; empty is rejected at construction."""

    projection_dim: int = 1024
    patchify_factor: int = 2
    image_size: tuple[int, int] = (288, 512)
    """Encoder input resolution the projection was trained at."""

    device: str = "cuda"
    compile_encoder: bool = True
    """``torch.compile`` the encoder. Every chunk has one static input shape."""


class ProxyDinoControlEncoder:
    """Encode rendered game frames into DiT-grid control features."""

    def __init__(self, config: ProxyDinoEncoderConfig) -> None:
        from transformers import AutoModel

        if not config.backbone_repo or not config.projection_path:
            raise ValueError(
                "ProxyDinoEncoderConfig needs backbone_repo and projection_path; "
                "both come from the pipeline YAML's components block."
            )
        self.config = config
        # First time through this runs during the first chunk, so it shows up
        # as a stall in front of the first frame rather than during startup.
        logger.info(
            "Loading proxy-DINO backbone {} and projection {}",
            config.backbone_repo,
            config.projection_path,
        )
        load_started = time.perf_counter()
        backbone = AutoModel.from_pretrained(
            config.backbone_repo, local_files_only=True
        )
        encoder = ProxyDinoEncoder(
            backbone,
            projection_dim=config.projection_dim,
            patchify_factor=config.patchify_factor,
        )
        projection_path = _resolve_projection_path(config.projection_path)
        if projection_path.endswith(".safetensors"):
            from safetensors.torch import load_file

            # The published file is flat: every key already carries its
            # ``model.module.`` prefix, so there is no "model" dict to unwrap.
            checkpoint = load_file(projection_path, device="cpu")
        else:
            checkpoint = torch.load(
                projection_path,
                map_location="cpu",
                weights_only=True,
                mmap=True,
            )
        state = (
            checkpoint["model"]
            if isinstance(checkpoint, dict) and "model" in checkpoint
            else checkpoint
        )
        if not isinstance(state, dict):
            raise TypeError(
                "proxy-DINO checkpoint must be a state dict or contain a "
                "'model' state dict"
            )
        encoder_state = extract_shared_encoder_state_dict(state)
        # The training checkpoint may nest the HF backbone one level deeper
        # (``backbone.model.*``) than ``AutoModel`` exposes it.
        model_keys = set(encoder.state_dict())
        encoder_state = {
            (
                f"backbone.model.{key.removeprefix('backbone.')}"
                if key.startswith("backbone.")
                and f"backbone.model.{key.removeprefix('backbone.')}" in model_keys
                else key
            ): value
            for key, value in encoder_state.items()
        }
        encoder.load_state_dict(encoder_state, strict=True)
        encoder = encoder.to(device=config.device).requires_grad_(False).eval()
        logger.info(
            "Proxy-DINO weights loaded onto {} in {:.1f}s",
            config.device,
            time.perf_counter() - load_started,
        )
        self.encoder = encoder
        self._call = encoder
        if config.compile_encoder:
            from flashdreams.infra.compile import compile_module

            # The trace itself is deferred to the first encode, which is where
            # a long pause with no further log lines comes from.
            logger.info("Compiling the proxy-DINO encoder (lazy until first encode)")
            compile_started = time.perf_counter()
            self._call = compile_module(encoder)
            logger.info(
                "Proxy-DINO compile wrapper installed in {:.1f}s",
                time.perf_counter() - compile_started,
            )

    @property
    def feature_dim(self) -> int:
        return self.encoder.feature_dim

    @torch.no_grad()
    def encode(
        self,
        frames: Tensor,
        *,
        latent_height: int,
        latent_width: int,
        dtype: torch.dtype,
    ) -> Tensor:
        """Encode ``[T, 3, H, W]`` RGB in ``[0, 1]`` onto the latent grid.

        Returns ``[T, C, latent_height, latent_width]``. The spatial
        resample is trilinear over ``(T, h, w)`` with the temporal axis
        left at its own length, matching the reference's
        ``F.interpolate(..., mode="trilinear")`` against the latent shape.
        """
        frames = frames.to(device=self.config.device)
        if self._call is self.encoder:
            features = self._call(frames, image_size=self.config.image_size)
        else:
            # The encode runs on its own thread, while the DiT compiles on the
            # main one. Dynamo's FX trace sets a process-wide "FX is tracing"
            # flag, and a compiled module entered from any thread while that
            # flag is up raises instead of running. Dynamo holds this lock for
            # the whole of each compile, so taking it here makes the encode
            # wait out a DiT compile. Outside a compile nothing else holds it.
            with _dynamo_compile_lock():
                features = self._call(frames, image_size=self.config.image_size)
        # [T, C, h, w] -> [1, C, T, h, w] for the volumetric resample.
        volume = features.permute(1, 0, 2, 3).unsqueeze(0)
        if volume.shape[-2:] != (latent_height, latent_width):
            volume = F.interpolate(
                volume,
                size=(volume.shape[2], latent_height, latent_width),
                mode="trilinear",
                align_corners=False,
            )
        return volume.squeeze(0).permute(1, 0, 2, 3).to(dtype=dtype).contiguous()


def _dynamo_compile_lock() -> AbstractContextManager[object]:
    """Return dynamo's compile lock, or a no-op if this torch lacks one."""
    from torch._dynamo import convert_frame

    lock = getattr(convert_frame, "compile_lock", None)
    return lock if lock is not None else nullcontext()


__all__ = [
    "ProxyDinoControlEncoder",
    "ProxyDinoEncoder",
    "ProxyDinoEncoderConfig",
    "extract_shared_encoder_state_dict",
]
