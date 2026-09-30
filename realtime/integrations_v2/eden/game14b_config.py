# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Config for the proxy-DINO conditioned AR 14B Game2V model.

Kept out of :mod:`eden.config` because that module's ``PIPELINE_CONFIGS`` is
typed to the camera-control pipeline; this model conditions on rendered game
frames through DINOv3 instead of Plücker camera volumes, so it is a different
pipeline type entirely.

The chunk size (``len_t=3`` latent frames at 480x832) comes from the
recipe's own AR teacher-forcing config. The sampling schedule and the
attention window are copied from LingBot-World v2 14B causal-fast: a
4-step distilled flow schedule at shift 10.0 with CFG off, over a
sliding window of 18 latent frames.
"""

from __future__ import annotations

import torch

from flashdreams.infra.config import derive_config
from flashdreams.infra.diffusion.model import DiffusionModelConfig
from flashdreams.infra.diffusion.scheduler import FlowMatchSchedulerConfig
from flashdreams.recipes.taehv import TeahvVAEDecoderConfig
from flashdreams.recipes.wan.autoencoder.vae import (
    WanVAEDecoderConfig,
    WanVAEEncoderConfig,
)
from eden.impl.game14b.encoder import Game14BCtrlEncoderConfig
from eden.impl.game14b.network import Game14BDiTNetworkConfig
from eden.impl.game14b.pipeline import Game14BInferencePipelineConfig
from eden.impl.game14b.transformer import Game14BTransformerConfig

GAME2V_EDEN_WORLD_V2_14B_CHECKPOINT_PATH = (
    "/root/cache/dit/2026-09-22-14b-ar-tf-full-20e1c566/step_008000"
)
"""AR teacher-forced 14B DCP checkpoint, as staged by ``copy_models_cache.sh``.

A torch distributed checkpoint directory (32 shards + ``.metadata``) written
by FSDP2, so it is read through
:func:`eden.impl.game14b.checkpoint.load_game14b_dit_state_dict` rather than
the stock safetensors loader.
"""

# Latent frames per AR chunk. Combined with the VAE's 4x temporal ratio this
# is 9 decoded frames at AR 0 and 12 after, which is what the game renderer
# paces its capture against.
GAME2V_LEN_T = 3

# Sliding window copied from LingBot-World v2 14B causal-fast
# (``--local_attn_size 18``). No sink: the window simply slides.
GAME2V_WINDOW_SIZE_T = 18

PIPELINE_GAME2V_EDEN_WORLD_V2_14B = Game14BInferencePipelineConfig(
    name="game2v-eden-world-v2-14b",
    encoder=Game14BCtrlEncoderConfig(
        encoder=WanVAEEncoderConfig(),
    ),
    decoder=WanVAEDecoderConfig(),
    # The first-frame condition is the cover's own latent plus a grey tail the
    # encoder caches per resolution, so nothing here pins its length: the
    # session passes ``total_blocks * len_t`` at cache build time, and a clip
    # shorter than the rollout makes a later AR step read past its end.
    diffusion_model=DiffusionModelConfig(
        seed=42,
        transformer=Game14BTransformerConfig(
            network=Game14BDiTNetworkConfig(),
            dcp_checkpoint_path=GAME2V_EDEN_WORLD_V2_14B_CHECKPOINT_PATH,
            # Single-rollout layout: no leading batch dim.
            batch_shape=(),
            len_t=GAME2V_LEN_T,
            # CFG off, matching LingBot-World v2 14B causal-fast. With no
            # unconditional branch the DINO control is encoded once per chunk.
            guidance_scale=1.0,
            # Sliding window of 18 latent frames, no sink.
            window_size_t=GAME2V_WINDOW_SIZE_T,
            sink_size_t=0,
            # Channel-concat I2V (mask + first-frame latent), not stamping.
            stamp_image_latent=False,
            concat_image_mask_to_latent=True,
            compile_network=True,
        ),
        # LingBot-World v2 14B causal-fast distilled schedule verbatim:
        # timesteps_index [0, 250, 500, 750] -> [1000, 750, 500, 250],
        # warped through the shift-10 sigma table stored as int64.
        scheduler=FlowMatchSchedulerConfig(
            num_inference_steps=4,
            denoising_timesteps=[1000, 750, 500, 250],
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
"""Proxy-DINO conditioned AR 14B pipeline for the Game2V app."""


# Same model and schedule with the Wan VAE decoder swapped for the LightTAE
# tiny decoder. Compression ratios (temporal 4, spatial 8) and latent width
# (16) match the Wan VAE, so frame counts and the capture pacing are
# unchanged; only decode speed and fidelity differ.
PIPELINE_GAME2V_EDEN_WORLD_V2_14B_TAEHV = derive_config(
    PIPELINE_GAME2V_EDEN_WORLD_V2_14B,
    name="game2v-eden-world-v2-14b-taehv",
    decoder=TeahvVAEDecoderConfig(),
)
"""The 14B pipeline with the LightTAE decoder instead of the Wan VAE."""


__all__ = [
    "GAME2V_EDEN_WORLD_V2_14B_CHECKPOINT_PATH",
    "GAME2V_LEN_T",
    "GAME2V_WINDOW_SIZE_T",
    "PIPELINE_GAME2V_EDEN_WORLD_V2_14B",
    "PIPELINE_GAME2V_EDEN_WORLD_V2_14B_TAEHV",
]
