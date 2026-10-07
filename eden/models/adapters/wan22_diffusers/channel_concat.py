"""Wan2.2 patch-embedding expansion for channel-concatenated conditions."""

from __future__ import annotations

import torch
from torch import nn


class _RMSNormChannelConcatConv3d(nn.Conv3d):
    """Patch embedding which normalizes only the appended condition channels."""

    def __init__(self, *args, condition_channels: int, **kwargs):
        super().__init__(*args, **kwargs)
        self.condition_channels = int(condition_channels)
        if self.condition_channels <= 0:
            raise ValueError("condition_channels must be positive")
        # Keep the affine scale in fp32, matching the reference Proxy-DINO
        # implementation and making it an ordinary trainable transformer
        # parameter (rather than adapter-global state).
        self.condition_norm = nn.RMSNorm(
            self.condition_channels,
            eps=1.0e-6,
            elementwise_affine=True,
            device=self.weight.device,
            dtype=torch.float32,
        )

    def forward(self, input):
        latent_channels = int(self.in_channels) - self.condition_channels
        if input.ndim != 5 or int(input.shape[1]) != int(self.in_channels):
            raise ValueError(
                "RMSNorm channel-concat patch embedding expects input shape "
                f"[B,{self.in_channels},T,H,W], got {tuple(input.shape)}"
            )
        latent = input[:, :latent_channels]
        condition = input[:, latent_channels:]
        # The feature/channel dimension is the normalized dimension. Compute
        # statistics in fp32, then restore the Conv3d input dtype.
        condition = condition.permute(0, 2, 3, 4, 1)
        condition = self.condition_norm(condition.float()).to(dtype=input.dtype)
        condition = condition.permute(0, 4, 1, 2, 3)
        return super().forward(torch.cat((latent, condition), dim=1))

def enable_wan_channel_concat(
    model,
    control_dim: int,
    *,
    zero_init_control_channels: bool = True,
    condition_rmsnorm: bool = False,
) -> None:
    """Expand a Wan patch embedding while preserving its pretrained behavior.

    Existing latent-channel weights and bias are copied exactly.  By default,
    all newly added control-channel weights are zero, so a fresh
    proxy-conditioned model is numerically identical to the original Wan
    transformer until finetuned.  ``zero_init_control_channels=False`` keeps
    the Conv3d default initialization for ablations. When ``condition_rmsnorm``
    is enabled, only the appended control feature is passed through a
    trainable affine RMSNorm (eps=1e-6) immediately before the Conv3d. The
    helper also works during FSDP2 meta initialization.
    """

    control_dim = int(control_dim)
    if control_dim <= 0:
        raise ValueError("control_dim must be positive")
    latent_dim = int(model.config.in_channels)
    old_embedding = model.patch_embedding
    expected_channels = latent_dim + control_dim
    # A checkpoint that already stored the widened embedding loads as a plain
    # Conv3d at the target width. It still needs the RMSNorm wrapper, so it falls
    # through to the rebuild below, which copies its trained weights over.
    if int(old_embedding.in_channels) == expected_channels and not getattr(model, "_eden_loaded_widened", False):
        existing = getattr(model, "_eden_channel_concat_control_dim", control_dim)
        if int(existing) != control_dim:
            raise ValueError(
                f"Wan patch embedding is already expanded for control_dim={existing}, not {control_dim}"
            )
        existing_zero_init = getattr(
            model,
            "_eden_channel_concat_zero_init_control_channels",
            bool(zero_init_control_channels),
        )
        if bool(existing_zero_init) != bool(zero_init_control_channels):
            raise ValueError(
                "Wan patch embedding is already expanded with "
                f"zero_init_control_channels={existing_zero_init}, not {zero_init_control_channels}"
            )
        existing_rmsnorm = bool(getattr(model, "_eden_channel_concat_condition_rmsnorm", False))
        if existing_rmsnorm != bool(condition_rmsnorm):
            raise ValueError(
                "Wan patch embedding is already expanded with "
                f"condition_rmsnorm={existing_rmsnorm}, not {condition_rmsnorm}"
            )
        return
    if int(old_embedding.in_channels) != latent_dim and not getattr(model, "_eden_loaded_widened", False):
        raise ValueError(
            f"Wan patch embedding has {old_embedding.in_channels} input channels; expected {latent_dim} "
            "before channel-concat expansion"
        )
    embedding_cls = _RMSNormChannelConcatConv3d if condition_rmsnorm else nn.Conv3d
    embedding_kwargs = {"condition_channels": control_dim} if condition_rmsnorm else {}
    expanded_embedding = embedding_cls(
        expected_channels,
        old_embedding.out_channels,
        kernel_size=old_embedding.kernel_size,
        stride=old_embedding.stride,
        padding=old_embedding.padding,
        dilation=old_embedding.dilation,
        groups=old_embedding.groups,
        bias=old_embedding.bias is not None,
        device=old_embedding.weight.device,
        dtype=old_embedding.weight.dtype,
        **embedding_kwargs,
    )
    # A checkpoint that already stored the widened embedding arrives as a plain
    # Conv3d with the trained weights on it. Copy those weights wholesale instead
    # of the base slice plus zeros, and carry its condition norm over.
    loaded_weight = getattr(old_embedding, "weight", None)
    loaded_widened = (
        getattr(model, "_eden_loaded_widened", False)
        and loaded_weight is not None
        and tuple(loaded_weight.shape) == tuple(expanded_embedding.weight.shape)
    )
    with torch.no_grad():
        if loaded_widened:
            expanded_embedding.weight.copy_(loaded_weight)
        else:
            if zero_init_control_channels:
                expanded_embedding.weight.zero_()
            expanded_embedding.weight[:, :latent_dim].copy_(old_embedding.weight)
        if old_embedding.bias is not None:
            expanded_embedding.bias.copy_(old_embedding.bias)
    if loaded_widened:
        loaded_norm = getattr(old_embedding, "condition_norm", None)
        if loaded_norm is not None and getattr(expanded_embedding, "condition_norm", None) is not None:
            expanded_embedding.condition_norm.load_state_dict(loaded_norm.state_dict())
    model.patch_embedding = expanded_embedding
    model._eden_channel_concat_control_dim = control_dim
    model._eden_loaded_widened = False
    model._eden_channel_concat_zero_init_control_channels = bool(zero_init_control_channels)
    model._eden_channel_concat_condition_rmsnorm = bool(condition_rmsnorm)


def channel_concat_condition_norm_parameters(module):
    """Yield the optional FP32 RMSNorm affine parameters under ``module``."""

    seen: set[int] = set()
    for child in module.modules():
        condition_norm = getattr(child, "condition_norm", None)
        if condition_norm is None:
            continue
        for parameter in condition_norm.parameters():
            if id(parameter) in seen:
                continue
            seen.add(id(parameter))
            yield parameter


__all__ = ["channel_concat_condition_norm_parameters", "enable_wan_channel_concat"]
