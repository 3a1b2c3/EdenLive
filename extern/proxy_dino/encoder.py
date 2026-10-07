"""DINOv3 control encoder for proxy-to-real video conditioning.

This is the inference portion of the encoder used by the reference recipe.
It turns DINO patch tokens into a projected, L2-normalized feature grid.  The
encoder is always frozen; its features are consumed by the Wan adapter as a
channel-concatenated DiT condition.
"""

from __future__ import annotations

from typing import Any

import torch
import torch.nn.functional as F
from torch import nn


DINOV3_IMAGE_MEAN = (0.485, 0.456, 0.406)
DINOV3_IMAGE_STD = (0.229, 0.224, 0.225)


def extract_shared_encoder_state_dict(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Extract the shared encoder fields from the reference training checkpoint."""

    encoder_state: dict[str, torch.Tensor] = {}
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


class DINOv3CheckpointEncoder(nn.Module):
    """Frozen DINOv3 backbone plus reference-compatible patch projection."""

    def __init__(
        self,
        backbone: nn.Module,
        projection_dim: int | None = 1024,
        patchify_factor: int = 2,
    ) -> None:
        super().__init__()
        self.backbone = backbone
        self.patchify_factor = int(patchify_factor)
        if self.patchify_factor < 1:
            raise ValueError("patchify_factor must be positive")
        hidden_size = int(backbone.config.hidden_size)
        if projection_dim is None:
            self.global_projection = None
            self.patch_projection = None
            self.feature_dim = hidden_size
        else:
            self.global_projection = nn.Linear(hidden_size, int(projection_dim))
            self.patch_projection = nn.Linear(hidden_size * self.patchify_factor**2, int(projection_dim))
            self.feature_dim = int(projection_dim)

    @property
    def patch_size(self) -> int:
        return int(self.backbone.config.patch_size)

    @property
    def num_register_tokens(self) -> int:
        return int(getattr(self.backbone.config, "num_register_tokens", 0))

    def _patch_grid(self, tokens: torch.Tensor, image_shape: tuple[int, int]) -> torch.Tensor:
        height = int(image_shape[0]) // self.patch_size
        width = int(image_shape[1]) // self.patch_size
        factor = self.patchify_factor
        if height % factor or width % factor:
            raise ValueError(
                f"DINO patch grid {height}x{width} is not divisible by patchify_factor={factor}"
            )
        patch_start = 1 + self.num_register_tokens
        patch_tokens = tokens[patch_start : patch_start + height * width]
        if int(patch_tokens.shape[0]) != height * width:
            raise ValueError("DINO output does not contain the expected number of patch tokens")
        patch_grid = patch_tokens.reshape(height, width, -1)
        patch_grid = patch_grid.reshape(height // factor, factor, width // factor, factor, -1)
        return patch_grid.permute(0, 2, 1, 3, 4).flatten(2)


def create_checkpoint_dinov3_encoder(
    model_path: str,
    checkpoint_path: str,
    *,
    projection_dim: int = 1024,
    patchify_factor: int = 2,
    local_files_only: bool = True,
) -> DINOv3CheckpointEncoder:
    """Load the frozen projected DINOv3 checkpoint used by proxy-to-real."""

    from transformers import AutoModel

    backbone = AutoModel.from_pretrained(model_path, local_files_only=local_files_only)
    encoder = DINOv3CheckpointEncoder(
        backbone,
        projection_dim=projection_dim,
        patchify_factor=patchify_factor,
    )
    if checkpoint_path.endswith(".safetensors"):
        from safetensors.torch import load_file

        checkpoint = load_file(checkpoint_path, device="cpu")
    else:
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True, mmap=True)
    state = checkpoint["model"] if isinstance(checkpoint, dict) and "model" in checkpoint else checkpoint
    if not isinstance(state, dict):
        raise TypeError("DINO checkpoint must be a state dictionary or contain a 'model' state dictionary")
    encoder_state = extract_shared_encoder_state_dict(state)
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
    return encoder.requires_grad_(False).eval()


def create_pretrained_dinov3_encoder(
    model_path: str,
    *,
    local_files_only: bool = True,
) -> DINOv3CheckpointEncoder:
    """Create an unprojected frozen DINOv3 encoder for diagnostics."""

    from transformers import AutoModel

    backbone = AutoModel.from_pretrained(model_path, local_files_only=local_files_only)
    return DINOv3CheckpointEncoder(backbone, projection_dim=None, patchify_factor=1).requires_grad_(False).eval()


@torch.no_grad()
def encode_proxy_dino(
    encoder: DINOv3CheckpointEncoder,
    images: torch.Tensor,
    *,
    image_size: tuple[int, int] = (288, 512),
) -> torch.Tensor:
    """Encode RGB images to ``[N, C, 1, Hpatch, Wpatch]`` proxy features."""

    if images.ndim != 4 or int(images.shape[1]) != 3:
        raise ValueError(f"DINO control images must be [N,3,H,W], got {tuple(images.shape)}")
    pixel_values = F.interpolate(
        images.float(), size=tuple(image_size), mode="bilinear", align_corners=False, antialias=True
    )
    mean = pixel_values.new_tensor(DINOV3_IMAGE_MEAN).view(1, 3, 1, 1)
    std = pixel_values.new_tensor(DINOV3_IMAGE_STD).view(1, 3, 1, 1)
    pixel_values = (pixel_values - mean) / std
    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=pixel_values.is_cuda):
        output = encoder.backbone(pixel_values=pixel_values)
    grids = torch.stack([encoder._patch_grid(tokens, tuple(pixel_values.shape[-2:])) for tokens in output.last_hidden_state])
    if encoder.patch_projection is None:
        return grids.permute(0, 3, 1, 2).unsqueeze(2).contiguous()
    projected = F.normalize(encoder.patch_projection(grids.float()), p=2, dim=-1)
    return projected.permute(0, 3, 1, 2).unsqueeze(2).contiguous()
