"""DINOv3 control encoder for proxy-to-real video conditioning.

This inference-only encoder uses a frozen DINOv3 backbone and learned projection.
It turns DINO patch tokens into a projected, L2-normalized feature grid.  The
encoder is always frozen; its features are consumed by the Wan adapter as a
channel-concatenated DiT condition.
"""

from __future__ import annotations


import torch
import torch.nn.functional as F
from torch import nn


DINOV3_IMAGE_MEAN = (0.485, 0.456, 0.406)
DINOV3_IMAGE_STD = (0.229, 0.224, 0.225)


def extract_shared_encoder_state_dict(state: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Extract the shared encoder fields from a training checkpoint."""

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
    """Frozen DINOv3 backbone plus a learned patch projection."""

    def __init__(
        self,
        backbone: nn.Module,
        projection_dim: int | None = 1024,
        patchify_factor: int = 1,
    ) -> None:
        super().__init__()
        self.backbone = backbone
        # 1 means one DINO token per projected vector, which is what the released
        # projection was trained for: ``patch_projection`` is (projection_dim,
        # hidden_size). A factor of f groups fxf tokens and needs a projection of
        # (projection_dim, hidden_size * f**2) trained that way.
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
    patchify_factor: int = 1,
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


@torch.no_grad()
def encode_proxy_dino(
    encoder: DINOv3CheckpointEncoder,
    images: torch.Tensor,
    *,
    image_size: tuple[int, int] = (288, 512),
    resize_mode: str = "bilinear",
    projection_autocast: bool = False,
) -> torch.Tensor:
    """Encode [0,1] RGB to ``[N,C,1,Hpatch,Wpatch]`` proxy features.

    The default uses antialiased tensor bilinear resize. PIL profiles use
    bicubic resize or bicubic center-crop and can autocast the projection as
    well as the backbone. Weights stay FP32.
    """

    if images.ndim != 4 or int(images.shape[1]) != 3:
        raise ValueError(f"DINO control images must be [N,3,H,W], got {tuple(images.shape)}")
    if resize_mode == "bilinear":
        pixel_values = F.interpolate(
            images.float(), size=tuple(image_size), mode="bilinear", align_corners=False, antialias=True
        )
    elif resize_mode in ("bicubic_center_crop", "bicubic"):
        import numpy as np
        from PIL import Image

        # PIL's uint8 bicubic path is the registered encoder's preprocessing;
        # tensor bicubic is not numerically equivalent. Transfer one batch.
        rgb = images.detach().float().clamp(0, 1).mul(255).round().to(torch.uint8)
        rgb = rgb.permute(0, 2, 3, 1).cpu().numpy()
        target_h, target_w = image_size
        cropped = []
        for array in rgb:
            image = Image.fromarray(array)
            if resize_mode == "bicubic":
                image = image.resize((target_w, target_h), Image.Resampling.BICUBIC)
                cropped.append(torch.from_numpy(np.array(image)).permute(2, 0, 1))
                continue
            width, height = image.size
            image_ratio = width / height
            if image_ratio > target_w / target_h:
                resized_h, resized_w = target_h, round(target_h * image_ratio)
            else:
                resized_w, resized_h = target_w, round(target_w / image_ratio)
            image = image.resize((resized_w, resized_h), Image.Resampling.BICUBIC)
            left, top = (resized_w - target_w) // 2, (resized_h - target_h) // 2
            image = image.crop((left, top, left + target_w, top + target_h))
            cropped.append(torch.from_numpy(np.array(image)).permute(2, 0, 1))
        pixel_values = torch.stack(cropped).to(device=images.device, dtype=torch.float32) / 255.0
    else:
        raise ValueError(f"Unknown proxy-DINO resize_mode: {resize_mode!r}")
    mean = pixel_values.new_tensor(DINOV3_IMAGE_MEAN).view(1, 3, 1, 1)
    std = pixel_values.new_tensor(DINOV3_IMAGE_STD).view(1, 3, 1, 1)
    pixel_values = (pixel_values - mean) / std
    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=pixel_values.is_cuda):
        output = encoder.backbone(pixel_values=pixel_values)
    grids = torch.stack([encoder._patch_grid(tokens, tuple(pixel_values.shape[-2:])) for tokens in output.last_hidden_state])
    if encoder.patch_projection is None:
        return grids.permute(0, 3, 1, 2).unsqueeze(2).contiguous()
    if projection_autocast:
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=grids.is_cuda):
            projected = F.normalize(encoder.patch_projection(grids), p=2, dim=-1).float()
    else:
        projected = F.normalize(encoder.patch_projection(grids.float()), p=2, dim=-1)
    return projected.permute(0, 3, 1, 2).unsqueeze(2).contiguous()
