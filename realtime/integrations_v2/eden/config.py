# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Configs for the LingBot-World streaming camera-control I2V model."""

from __future__ import annotations

import torch

from flashdreams.infra.config import derive_config
from flashdreams.infra.diffusion.model import DiffusionModelConfig
from flashdreams.infra.diffusion.scheduler import FlowMatchUniPCSchedulerConfig
from flashdreams.infra.diffusion.scheduler.fm import FlowMatchSchedulerConfig
from flashdreams.recipes.taehv import TeahvVAEDecoderConfig
from flashdreams.recipes.wan.autoencoder.vae import (
    WanVAEDecoderConfig,
    WanVAEEncoderConfig,
)
from eden.impl.encoder.camctrl import (
    I2VCamCtrlEncoderConfig,
    EdenI2VCtrlEncoderConfig,
)
from eden.impl.pipeline import EdenWorldInferencePipelineConfig
from eden.impl.transformer import EdenWorldTransformerConfig
from eden.impl.transformer.impl.network import (
    EdenWorldDiTNetwork1pt3BConfig,
    EdenWorldDiTNetwork14BConfig,
)

EDEN_WORLD_V1_CHECKPOINT_PATH = (
    "https://huggingface.co/robbyant/lingbot-world-fast/blob/main/"
    "diffusion_pytorch_model.safetensors.index.json"
)
"""LingBot-World v1 transformer checkpoint index."""

EDEN_WORLD_V2_CHECKPOINT_PATH = (
    "https://huggingface.co/robbyant/lingbot-world-v2-14b-causal-fast/blob/main/"
    "transformers/diffusion_pytorch_model.safetensors.index.json"
)
"""LingBot-World v2 transformer checkpoint index."""

EDEN_WORLD_V2_1PT3B_CAUSAL_FAST_CHECKPOINT_PATH = (
    "https://huggingface.co/robbyant/lingbot-world-v2-1.3b-causal-fast/blob/main/"
    "model.safetensors.index.json"
)
"""LingBot-World v2 1.3B causal-fast transformer checkpoint index.

The upstream 1.3B upload ships DiT shards only (no T5/VAE/tokenizer); those
shared assets come from the same encoder/decoder configs the 14B presets use.
"""

EDEN_WORLD_V2_14B_CAUSAL_PRETRAIN_CHECKPOINT_PATH = (
    "https://huggingface.co/robbyant/lingbot-world-v2-14b-causal-pretrain/"
    "blob/main/transformer_causal/diffusion_pytorch_model.safetensors.index.json"
)
"""LingBot-World v2 14B causal-pretrain (40-step + CFG) checkpoint index."""

CHECKPOINT_PATH = EDEN_WORLD_V1_CHECKPOINT_PATH
"""Backward-compatible alias for the LingBot-World v1 checkpoint."""


# Official LingBot-World-Fast pipeline config.
PIPELINE_EDEN_WORLD_FAST = EdenWorldInferencePipelineConfig(
    name="eden-world-fast",
    encoder=I2VCamCtrlEncoderConfig(
        i2v=EdenI2VCtrlEncoderConfig(
            encoder=WanVAEEncoderConfig(),
        ),
    ),
    decoder=WanVAEDecoderConfig(),
    diffusion_model=DiffusionModelConfig(
        seed=42,
        transformer=EdenWorldTransformerConfig(
            network=EdenWorldDiTNetwork14BConfig(
                patch_embedding_type="conv3d",
                control_type="cam",
                cp_method="ulysses",
                # 16 noise channels + 4-channel mask + 16-channel image latent
                # (channel-concat I2V layout). Must match the
                # ``concat_image_mask_to_latent=True`` setting below.
                in_dim=16 + 4 + 16,
            ),
            checkpoint_path=EDEN_WORLD_V1_CHECKPOINT_PATH,
            stream_checkpoint=True,
            # Single-rollout layout: tensors flow through the stack as
            # ``[T, C, H, W]`` (or ``[T, ...]``) with no leading batch/view dim.
            batch_shape=(),
            # Latent frames the transformer consumes per AR chunk.
            len_t=3,
            # CFG off by default to match the upstream Eden checkpoint.
            guidance_scale=1.0,
            window_size_t=63,
            sink_size_t=0,
            # I2V channel-concat (mask + first-frame latent), not stamping.
            stamp_image_latent=False,
            concat_image_mask_to_latent=True,
            compile_network=True,
        ),
        scheduler=FlowMatchSchedulerConfig(
            # Upstream Fast 4-step distilled schedule (matches the
            # LingBot-World-Fast checkpoint).
            num_inference_steps=4,
            denoising_timesteps=[1000, 1000 - 179, 1000 - 358, 1000 - 679],
            warp_denoising_step=True,
            shift=10.0,
            sigma_max=0.999,
            sigma_min=0.0,
            extra_one_step=True,
            num_train_timesteps=1000,
            timestep_dtype=torch.int64,
        ),
    ),
)
# Faster interactive variant for persistent streaming:
# - LightTAE (TAEHV) decoder.
# - Tighter streaming window: ``window_size_t=15`` (down from 63).
# - Static sink: ``sink_size_t=3`` to keep early-frame anchors.
PIPELINE_EDEN_WORLD_FAST_TAEHV_WINDOW15_SINK3 = derive_config(
    PIPELINE_EDEN_WORLD_FAST,
    name="eden-world-fast-taehv-window15-sink3",
    decoder=TeahvVAEDecoderConfig(),
    diffusion_model=dict(
        transformer=dict(
            window_size_t=15,
            sink_size_t=3,
        ),
    ),
)
# LingBot-World v2 uses the same architecture and runtime as v1. Model-level
# substitutions beyond the checkpoint: the official v2 4-step distilled
# schedule (``timesteps_index=[0, 250, 500, 750]``) and the official sliding
# window (``--local_attn_size 18 --sink_size 6`` from the v2 launch commands).
# It inherits the bounded checkpoint loader from the v1 base config.
PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST = derive_config(
    PIPELINE_EDEN_WORLD_FAST,
    name="eden-world-v2-14b-causal-fast",
    diffusion_model=dict(
        transformer=dict(
            checkpoint_path=EDEN_WORLD_V2_CHECKPOINT_PATH,
            window_size_t=18,
            sink_size_t=6,
        ),
        scheduler=dict(
            # Official v2 few-step grid ([0, 250, 500, 750] from
            # ``timesteps_index`` in the upstream launch config).
            denoising_timesteps=[1000, 750, 500, 250],
        ),
    ),
)
PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6 = derive_config(
    PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST,
    name="eden-world-v2-14b-causal-fast-taehv-window18-sink6",
    decoder=TeahvVAEDecoderConfig(),
    diffusion_model=dict(
        transformer=dict(
            window_size_t=18,
            sink_size_t=6,
        ),
    ),
)
# 1.3B causal-fast: same official schedule and windowing as the 14B fast
# variant; only the network shape, checkpoint, shift (5.0 upstream), and CP
# method differ. The upstream 1.3B launch uses Ulysses SP on 4 GPUs
# (12 heads / 4); on an 8-GPU node Ulysses cannot shard 12 heads, so
# ``ring`` token sharding is used here — it covers both GPU layouts.
PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST = derive_config(
    PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST,
    name="eden-world-v2-1.3b-causal-fast",
    diffusion_model=dict(
        transformer=dict(
            network=EdenWorldDiTNetwork1pt3BConfig(
                patch_embedding_type="conv3d",
                control_type="cam",
                cp_method="ring",
                # Same channel-concat I2V layout as the 14B preset.
                in_dim=16 + 4 + 16,
            ),
            checkpoint_path=EDEN_WORLD_V2_1PT3B_CAUSAL_FAST_CHECKPOINT_PATH,
            # The 1.3B upload is DiT-only (a few GiB), not the ~70 GiB the
            # 14B storage budget anticipates.
            checkpoint_min_free_gb=20.0,
        ),
        scheduler=dict(
            # Upstream 1.3B shift.
            shift=5.0,
        ),
    ),
)
PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6 = derive_config(
    PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST,
    name="eden-world-v2-1.3b-causal-fast-taehv-window18-sink6",
    decoder=TeahvVAEDecoderConfig(),
)
# 14B causal-pretrain: the 40-step UniPC + CFG 5.0 quality variant. The
# upstream launch runs global attention over its whole 81-frame rollout
# (frame_num=81 -> 21 latent frames post patchification); window_size_t=21
# reproduces that for the default 20-block rollout, with no sink. Run longer
# rollouts with a proportionally larger window.
PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_PRETRAIN = derive_config(
    PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST,
    name="eden-world-v2-14b-causal-pretrain",
    diffusion_model=dict(
        transformer=dict(
            checkpoint_path=EDEN_WORLD_V2_14B_CAUSAL_PRETRAIN_CHECKPOINT_PATH,
            # Upstream causal_pretrain sampling: CFG 5.0, dual cond/uncond
            # KV streams (negative prompt supplied by the pipeline).
            guidance_scale=5.0,
            window_size_t=21,
            sink_size_t=0,
        ),
        scheduler=FlowMatchUniPCSchedulerConfig(
            num_inference_steps=40,
            shift=10.0,
        ),
    ),
)
PIPELINE_CONFIGS: dict[str, EdenWorldInferencePipelineConfig] = {
    cfg.name: cfg
    for cfg in (
        PIPELINE_EDEN_WORLD_FAST,
        PIPELINE_EDEN_WORLD_FAST_TAEHV_WINDOW15_SINK3,
        PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST,
        PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6,
        PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST,
        PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6,
        PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_PRETRAIN,
    )
}
"""All shipped LingBot-World pipeline configs, keyed by ``name``."""
