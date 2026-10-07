# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Config for the proxy-DINO conditioned rollout-DMD Wan 2.2 TI2V-5B Game2V model.

Ported from the reference inference recipe
``easyvideo/configs/inference/wan22_5b_proxy_dino_to_real/proxy_dino-video-tiv2v-rollout_dmd_chunkar.yaml``
and the Stage-3 SGF training config it defaults onto. Every number below traces
to one of those two files:

* ``chunk_size: 3`` -> :data:`GAME2V_5B_LEN_T`.
* ``num_inference_steps: 4`` with ``scheduler.timesteps
  [1000, 937.5, 833.3333333333, 625]``, ``shift: 5.0`` and
  ``stochastic_sampling: true`` -> the :class:`FlowMatchSchedulerConfig` below.
* ``guidance_scale: 1.0`` -> CFG off, one conditional KV stream.
* ``kv_cache.context {max_latent_frames: 18, sink_latent_frames: 6}`` ->
  :data:`GAME2V_5B_WINDOW_SIZE_T` / :data:`GAME2V_5B_SINK_SIZE_T`.
* ``height: 704, width: 1280`` -> :data:`GAME2V_5B_PIXEL_HEIGHT` / ``_WIDTH``.
* ``pack_first_frame: true`` (from the Stage-3 ``rollout`` block, which the
  chunk-AR inference strategy honors) -> the TI2V stamp knobs.

Kept out of :mod:`eden.config` because that module's ``PIPELINE_CONFIGS`` is
typed to the camera-control pipeline; this model conditions on rendered game
frames through DINOv3 instead of Plücker camera volumes, so it is a different
pipeline type entirely. It is also separate from :mod:`eden.game14b_config`:
that one is Wan 2.1 14B I2V (channel-concat first frame, CLIP branch, 16-channel
8x VAE), this one is Wan 2.2 TI2V 5B (stamped first frame, no CLIP, 48-channel
16x VAE).

Two consequences of the 5B's 16x-spatial VAE are worth stating, because both
differ from every other Game2V preset:

* **Resolution is pinned to 704x1280.** The DiT's per-frame token count is
  ``(H/16/2) * (W/16/2)``, and ``Wan21Transformer`` asserts that the KV window
  and sink token counts divide by the CP size. 704x1280 gives 22*40 = 880
  tokens per latent frame, which 8 ranks shard evenly; the 480x832 the 14B runs
  at would give 15*26 = 390 and fail that assert on an 8-GPU node.
* **The LightTAE variant needs its own weights.** The 14B's tiny decoder is
  8x-spatial over 16 latent channels and cannot read this VAE's 48-channel 16x
  latents, so :data:`PIPELINE_GAME2V_EDEN_WORLD_V2_5B_TAEHV` uses the
  ``lighttaew2_2`` checkpoint through
  :class:`~flashdreams.recipes.taehv.TeahvVAEWan22DecoderConfig` instead.
"""

from __future__ import annotations

from flashdreams.infra.config import derive_config
from flashdreams.infra.diffusion.model import DiffusionModelConfig
from flashdreams.infra.diffusion.scheduler import FlowMatchSchedulerConfig
from flashdreams.recipes.taehv import TeahvVAEWan22DecoderConfig
from flashdreams.recipes.wan.autoencoder.vae import (
    Wan22TI2V5BVAEDecoderConfig,
    Wan22TI2V5BVAEEncoderConfig,
)
from eden.impl.game5b.encoder import Game5BCtrlEncoderConfig
from eden.impl.game5b.network import Game5BDiTNetworkConfig
from eden.impl.game5b.pipeline import Game5BInferencePipelineConfig
from eden.impl.game5b.transformer import Game5BTransformerConfig
from eden.model_root import EDEN_MODEL_ROOT

GAME2V_EDEN_WORLD_V2_5B_CHECKPOINT_PATH = f"{EDEN_MODEL_ROOT}/dit-5b/model.safetensors"
"""The distilled EMA of the cfgsame Stage-3 run (``step_000400``), published as
a single safetensors file with Diffusers keys. Read through
:func:`eden.impl.game5b.checkpoint.load_game5b_dit_state_dict`, which applies
the shared Diffusers remap.
"""

# Latent frames per AR chunk (``chunk_size: 3``). Combined with the VAE's 4x
# temporal ratio this is 9 decoded frames at AR 0 and 12 after, which is what
# the game renderer paces its capture against.
GAME2V_5B_LEN_T = 3

# ``kv_cache.context.max_latent_frames: 18`` is the *total* attention budget
# upstream, with ``sink_latent_frames: 6`` carved out of it (see
# ``_select_cache_window_ranges``: the recent window gets
# ``max_attention_tokens - sink_attention_tokens``). FlashDreams instead sizes
# the arena as ``sink_size_t + window_size_t``, so the same 18-frame budget is
# 6 sink + 12 rolling.
GAME2V_5B_SINK_SIZE_T = 6
GAME2V_5B_WINDOW_SIZE_T = 12

# The reference renders and generates at 704x1280 (``height``/``width``). This
# is not a free choice here; see the module docstring.
GAME2V_5B_PIXEL_HEIGHT = 704
GAME2V_5B_PIXEL_WIDTH = 1280

# ``fps: 24`` upstream. The renderer paces its capture against this, so it is
# the model's own frame rate rather than a presentation preference.
GAME2V_5B_FPS = 24

PIPELINE_GAME2V_EDEN_WORLD_V2_5B = Game5BInferencePipelineConfig(
    name="game2v-eden-world-v2-5b",
    encoder=Game5BCtrlEncoderConfig(
        encoder=Wan22TI2V5BVAEEncoderConfig(),
    ),
    decoder=Wan22TI2V5BVAEDecoderConfig(),
    # Wan 2.2 TI2V-5B has no CLIP vision tower; the first frame is conditioned
    # through the clean-latent stamp instead.
    image_encoder=None,
    diffusion_model=DiffusionModelConfig(
        seed=42,
        # ``context_noise_sigma: 0.0`` upstream: the AR cache is committed from
        # the clean latent, so the cache-update forward runs at t=0.
        context_noise=0,
        transformer=Game5BTransformerConfig(
            network=Game5BDiTNetworkConfig(),
            dcp_checkpoint_path=GAME2V_EDEN_WORLD_V2_5B_CHECKPOINT_PATH,
            # Single-rollout layout: no leading batch dim.
            batch_shape=(),
            len_t=GAME2V_5B_LEN_T,
            # CFG off (``guidance_scale: 1.0``). With no unconditional branch
            # the DINO control is encoded once per chunk.
            guidance_scale=1.0,
            window_size_t=GAME2V_5B_WINDOW_SIZE_T,
            sink_size_t=GAME2V_5B_SINK_SIZE_T,
            # ``pack_first_frame: true``: the cover's latent rides inside the
            # first denoising chunk rather than being committed ahead of it. The
            # stamp re-injects it before every forward and the per-token
            # timestep holds those tokens at t=0 while the rest of the chunk
            # denoises. Wan 2.2 TI2V seeds the first frame this way rather than
            # by channel-concatenating a mask, so no mask channels are appended.
            stamp_image_latent=True,
            ti2v_first_frame_per_token_timestep=True,
            concat_image_mask_to_latent=False,
            compile_network=True,
        ),
        # The reference's explicit 4-step grid, reached through the warped
        # sigma table rather than restated: ``denoising_timesteps`` index the
        # shift-5 table at ``1000 - t``, which yields
        # ``[1000, 937.5, 833.3333, 625]`` -- the upstream ``timesteps`` list
        # exactly (verified in fp32 against the reference values).
        #
        # ``stochastic_sampling: true`` is this scheduler's own loop: each step
        # converts the flow to x0 and re-noises at the next sigma, rather than
        # taking a deterministic Euler step. ``terminal_sigma: 0.0`` upstream
        # means the last call returns x0 directly, which is what it does here.
        #
        # Timesteps stay fp32 (not the int64 the 14B pins): easy-video feeds
        # this model float timesteps, and 937.5 would quantize to 937 in int64.
        scheduler=FlowMatchSchedulerConfig(
            num_inference_steps=4,
            denoising_timesteps=[1000, 750, 500, 250],
            warp_denoising_step=True,
            shift=5.0,
            sigma_max=1.0,
            sigma_min=0.0,
            extra_one_step=True,
            num_train_timesteps=1000,
        ),
    ),
)
"""Proxy-DINO conditioned rollout-DMD 5B pipeline for the Game2V app."""


# Same model and schedule with the Wan 2.2 VAE decoder swapped for the
# ``lighttaew2_2`` tiny decoder. Its compression ratios (temporal 4, spatial 16)
# and latent width (48) match the Wan 2.2 TI2V-5B VAE, so frame counts, latent
# sizes and the renderer's capture pacing are all unchanged; only decode speed
# and fidelity differ. The *encoder* stays the real VAE: the first frame is
# encoded once, so there is nothing to win there, and the stamped condition
# latent has to live in the same space the DiT was trained on.
PIPELINE_GAME2V_EDEN_WORLD_V2_5B_TAEHV = derive_config(
    PIPELINE_GAME2V_EDEN_WORLD_V2_5B,
    name="game2v-eden-world-v2-5b-taehv",
    decoder=TeahvVAEWan22DecoderConfig(),
)
"""The 5B pipeline with the LightTAE Wan 2.2 decoder instead of the Wan VAE."""


__all__ = [
    "GAME2V_5B_FPS",
    "GAME2V_5B_LEN_T",
    "GAME2V_5B_PIXEL_HEIGHT",
    "GAME2V_5B_PIXEL_WIDTH",
    "GAME2V_5B_SINK_SIZE_T",
    "GAME2V_5B_WINDOW_SIZE_T",
    "GAME2V_EDEN_WORLD_V2_5B_CHECKPOINT_PATH",
    "PIPELINE_GAME2V_EDEN_WORLD_V2_5B",
    "PIPELINE_GAME2V_EDEN_WORLD_V2_5B_TAEHV",
]
