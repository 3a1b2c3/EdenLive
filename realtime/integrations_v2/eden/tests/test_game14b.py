# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""CPU tests for the proxy-DINO conditioned AR 14B Game2V preset."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import torch

from eden.apps.game2v.game14b import (
    game_cover_path,
    resolve_game14b_conditioning,
)
from eden.apps.game2v.game_renderer import registered_game_slugs
from eden.game14b_config import (
    GAME2V_LEN_T,
    PIPELINE_GAME2V_EDEN_WORLD_V2_14B,
    PIPELINE_GAME2V_EDEN_WORLD_V2_14B_TAEHV,
)
from eden.impl.game14b.checkpoint import game14b_dit_state_dict_from_diffusers
from eden.impl.game14b.control_stream import _stack_condition_frames
from eden.impl.game14b.network import (
    GAME14B_CONTROL_DIM,
    GAME14B_I2V_CHANNELS,
)

pytestmark = pytest.mark.ci_cpu


def test_channel_layout_matches_the_checkpoint_patch_embedding() -> None:
    """1060 input channels: 16 noisy + 4 mask + 16 condition + 1024 control."""
    network = PIPELINE_GAME2V_EDEN_WORLD_V2_14B.diffusion_model.transformer.network
    assert GAME14B_I2V_CHANNELS == 36
    assert network.in_dim == GAME14B_I2V_CHANNELS + GAME14B_CONTROL_DIM == 1060
    assert network.control_dim == GAME14B_CONTROL_DIM
    # Wan 2.1 I2V ships a CLIP vision branch; the recipe keeps it on.
    assert network.cross_attn_enable_img is True


def test_sampling_matches_the_lingbot_v2_14b_schedule() -> None:
    """CFG off, 4-step distilled schedule at shift 10.0, window of 18."""
    pipeline = PIPELINE_GAME2V_EDEN_WORLD_V2_14B
    transformer = pipeline.diffusion_model.transformer
    scheduler = pipeline.diffusion_model.scheduler
    # CFG off, copied from LingBot-World v2 14B causal-fast.
    assert transformer.guidance_scale == 1.0
    assert transformer.len_t == GAME2V_LEN_T == 3
    assert transformer.concat_image_mask_to_latent is True
    assert transformer.stamp_image_latent is False
    # Official v2 few-step grid ([0, 250, 500, 750] from timesteps_index).
    assert scheduler.num_inference_steps == 4
    assert scheduler.denoising_timesteps == [1000, 750, 500, 250]
    assert scheduler.shift == 10.0
    assert scheduler.sigma_max == 0.999
    assert scheduler.timestep_dtype == torch.int64
    # Sliding window of 18 latent frames, no sink.
    assert transformer.window_size_t == 18
    assert transformer.sink_size_t == 0


def test_condition_clip_covers_the_whole_rollout() -> None:
    """The one-shot condition latent must span every AR step.

    It is encoded once and sliced per step, so a clip shorter than
    ``total_blocks * len_t`` makes a later step read past its end.
    """
    from eden.apps.game2v.session import _rollout_cache_kwargs

    # Unpinned: the session sizes the clip from the rollout it will run.
    assert PIPELINE_GAME2V_EDEN_WORLD_V2_14B.rollout_latent_frames is None

    def _initialize_cache(self, text, rollout_latent_frames=None):
        del self, text, rollout_latent_frames

    state = SimpleNamespace(
        pipeline=SimpleNamespace(
            initialize_cache=_initialize_cache,
            diffusion_model=SimpleNamespace(
                transformer=SimpleNamespace(config=SimpleNamespace(len_t=3))
            ),
        ),
        config=SimpleNamespace(total_blocks=20),
    )
    assert _rollout_cache_kwargs(state) == {"rollout_latent_frames": 60}


def test_restart_reuses_the_one_shot_encodings() -> None:
    """A second ``initialize_cache`` must not reload or re-run the encoders.

    The Game2V session rebuilds the rollout cache on every restart. Reloading
    the released UMT5 and CLIP encoders, and re-encoding the first-frame
    condition, is what makes that restart stall.
    """
    from eden.impl.game14b.encoder import Game14BCtrlEncoderCache
    from eden.impl.game14b.pipeline import Game14BInferencePipeline

    calls = {"base": 0, "condition": 0}

    class _Pipeline(Game14BInferencePipeline):
        def _initialize_cache_recording(self, text, image, **kwargs):
            del kwargs
            calls["base"] += 1
            cache = SimpleNamespace(
                image=image,
                encoder_cache=Game14BCtrlEncoderCache(vae={}),
                transformer_cache=SimpleNamespace(),
            )
            self._text_cache = (tuple(text), torch.zeros(1, 2))
            self._image_cache = (image, torch.zeros(1, 2))
            return cache

        def _initialize_cache_from_embeddings(
            self, text_embeddings, image, image_embeddings, *, height, width
        ):
            del height, width
            if text_embeddings is None or image_embeddings is None:
                return None
            return SimpleNamespace(
                image=image,
                encoder_cache=Game14BCtrlEncoderCache(vae={}),
                transformer_cache=SimpleNamespace(),
            )

    class _Encoder:
        temporal_compression_ratio = 4

        def encode_first_frame_condition(self, image, *, num_frames, cache):
            del image
            calls["condition"] += 1
            latent_frames = 1 + (num_frames - 1) // self.temporal_compression_ratio
            latent = torch.zeros(1, latent_frames, 16, 2, 2)
            cache.condition_latent = latent
            return latent

    pipeline = Game14BInferencePipeline.__new__(_Pipeline)
    # Bypass ``__init__``: it builds the real encoders and loads checkpoints.
    # Only the rollout-reuse bookkeeping this test exercises is needed here.
    pipeline._text_cache = None
    pipeline._negative_text_cache = None
    pipeline._image_cache = None
    pipeline._condition_cache = None
    pipeline._pending_text = None
    pipeline._pending_image = None
    pipeline.encoder = _Encoder()
    pipeline.diffusion_model = SimpleNamespace(
        transformer=SimpleNamespace(config=SimpleNamespace(len_t=3))
    )
    image = torch.zeros(1, 1, 3, 8, 8)

    first = pipeline.initialize_cache(["a cat"], image, rollout_latent_frames=60)
    second = pipeline.initialize_cache(["a cat"], image, rollout_latent_frames=60)

    # The encoders and the condition clip run on the first rollout only.
    assert calls == {"base": 1, "condition": 1}
    # The restarted rollout gets its own cache but the same condition latent.
    assert second is not first
    assert second.encoder_cache is not first.encoder_cache
    assert second.encoder_cache.condition_latent is first.encoder_cache.condition_latent

    # A prompt that actually changed is re-encoded; the anchor frame did not,
    # so the condition clip is still reused.
    pipeline.initialize_cache(["a dog"], image, rollout_latent_frames=60)
    assert calls == {"base": 2, "condition": 1}

    # The grey tail carries no image, so a new anchor frame re-encodes only its
    # own first latent frame and reuses the tail.
    other = torch.ones_like(image)
    pipeline.initialize_cache(["a cat"], other, rollout_latent_frames=60)
    assert calls == {"base": 3, "condition": 2}


def test_independent_tail_is_encoded_once_and_reused() -> None:
    """The grey tail is one VAE call per resolution, not one per rollout frame.

    ``independent`` splices the cover's own latent onto frames 1: of an
    all-zeros clip. That tail depends only on the frame geometry, and the
    streaming VAE's state is a window over its own input, so an all-zeros input
    makes every tail frame identical. A 10000-block rollout must therefore cost
    the same two encodes as a 2-block one.
    """
    from eden.impl.game14b.encoder import (
        Game14BCtrlEncoder,
        Game14BCtrlEncoderCache,
    )

    seen: list[tuple[int, int]] = []

    class _FakeVAE:
        temporal_compression_ratio = 4
        spatial_compression_ratio = 8

        def initialize_autoregressive_cache(self) -> dict:
            return {}

        def __call__(
            self, frames: torch.Tensor, *, autoregressive_index: int, cache: dict
        ) -> torch.Tensor:
            del cache
            count = int(frames.shape[-4])
            seen.append((autoregressive_index, count))
            latent_frames = 1 if count == 1 else count // 4
            # Distinct per call, so a reused tail is detectable by identity of
            # its values rather than by happening to be zeros.
            return frames.new_full(
                (*frames.shape[:-4], latent_frames, 16, 2, 2), float(len(seen))
            )

    encoder = Game14BCtrlEncoder.__new__(Game14BCtrlEncoder)
    encoder.encoder = _FakeVAE()
    encoder._grey_tail_cache = {}
    image = torch.zeros(1, 1, 3, 8, 8)

    short = encoder.encode_first_frame_condition(
        image, num_frames=1 + 5 * 4, cache=Game14BCtrlEncoderCache(vae={})
    )
    # Cover alone, then the grey clip's seed frame and its first tail chunk.
    assert seen == [(0, 1), (0, 1), (1, 4)]
    assert short.shape[-4] == 6
    # Frame 0 is the cover's own latent; every later frame is the one tail frame.
    assert torch.all(short[..., :1, :, :, :] == 1)
    assert torch.all(short[..., 1:, :, :, :] == 3)

    long = encoder.encode_first_frame_condition(
        image, num_frames=1 + 59 * 4, cache=Game14BCtrlEncoderCache(vae={})
    )
    # The tail was cached, so the long rollout encodes only its cover frame.
    assert seen == [(0, 1), (0, 1), (1, 4), (0, 1)]
    assert long.shape[-4] == 60
    assert torch.all(long[..., 1:, :, :, :] == 3)


def test_taehv_variant_swaps_only_the_decoder() -> None:
    """LightTAE matches the Wan VAE's compression, so pacing is unchanged."""
    from flashdreams.recipes.taehv import TeahvVAEDecoder, TeahvVAEDecoderConfig
    from flashdreams.recipes.wan.autoencoder.vae import WanVAE

    base = PIPELINE_GAME2V_EDEN_WORLD_V2_14B
    variant = PIPELINE_GAME2V_EDEN_WORLD_V2_14B_TAEHV
    assert isinstance(variant.decoder, TeahvVAEDecoderConfig)
    # The ratios live on the decoder implementations, and they must agree or
    # the renderer's capture pacing would drift from the decoded frames.
    assert (
        TeahvVAEDecoder.TEMPORAL_COMPRESSION_RATIO
        == WanVAE.TEMPORAL_COMPRESSION_RATIO
        == 4
    )
    assert (
        TeahvVAEDecoder.SPATIAL_COMPRESSION_RATIO
        == WanVAE.SPATIAL_COMPRESSION_RATIO
        == 8
    )
    # Sampling and the attention window are inherited unchanged.
    assert variant.diffusion_model.transformer.len_t == 3
    assert variant.diffusion_model.transformer.window_size_t == 18
    assert variant.diffusion_model.scheduler.num_inference_steps == 4


def test_negative_prompt_is_the_official_wan_string() -> None:
    """The camera model's v2 prompt must not leak into this recipe's CFG."""
    from flashdreams.recipes.wan.transformer.constants import NEGATIVE_PROMPT

    from eden.impl.game14b.pipeline import Game14BInferencePipeline
    from eden.impl.pipeline import EDEN_WORLD_V2_NEGATIVE_PROMPT

    assert Game14BInferencePipeline._negative_prompt() == NEGATIVE_PROMPT
    assert Game14BInferencePipeline._negative_prompt() != EDEN_WORLD_V2_NEGATIVE_PROMPT


@pytest.mark.parametrize("slug", registered_game_slugs())
def test_first_frame_comes_from_each_games_own_cover(slug: str) -> None:
    """Every game conditions on its own cover, not one shared image."""
    cover = game_cover_path(slug)
    assert cover.is_file()
    assert cover.parent.name == slug

    conditioning = resolve_game14b_conditioning(
        {"game": slug, "pixel_width": 832, "pixel_height": 480}
    )
    assert conditioning.first_frame_path == cover
    # The prompt defaults to the registry's static scene description.
    assert conditioning.prompt
    assert len(conditioning.prompt) > 40


def test_covers_differ_between_games() -> None:
    slugs = registered_game_slugs()
    assert {"subway-run", "boxed-in"} <= set(slugs)
    assert len({game_cover_path(slug) for slug in slugs}) == len(slugs)
    prompts = {
        slug: resolve_game14b_conditioning({"game": slug}).prompt
        for slug in slugs
    }
    assert len(set(prompts.values())) == len(slugs)


def test_explicit_image_and_prompt_override_the_registry(tmp_path) -> None:
    image = tmp_path / "frame.png"
    image.write_bytes(b"not really a png, only the path is read here")
    conditioning = resolve_game14b_conditioning(
        {"game": "boxed-in", "image_path": image, "prompt": "a custom prompt"}
    )
    assert conditioning.first_frame_path == image
    assert conditioning.prompt == "a custom prompt"


def test_unregistered_game_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unregistered game"):
        resolve_game14b_conditioning({"game": "no-such-game"})


def test_checkpoint_remap_covers_the_i2v_and_clip_branches() -> None:
    """The three key groups the shared Diffusers table does not handle."""
    source = {
        "blocks.0.attn2.add_k_proj.weight": torch.empty(0),
        "blocks.0.attn2.add_v_proj.weight": torch.empty(0),
        "blocks.0.attn2.norm_added_k.weight": torch.empty(0),
        "condition_embedder.image_embedder.norm1.weight": torch.empty(0),
        "condition_embedder.image_embedder.ff.net.0.proj.weight": torch.empty(0),
        "condition_embedder.image_embedder.ff.net.2.weight": torch.empty(0),
        "condition_embedder.image_embedder.norm2.weight": torch.empty(0),
        "patch_embedding.condition_norm.weight": torch.empty(0),
    }
    remapped = game14b_dit_state_dict_from_diffusers(source)
    assert set(remapped) == {
        "blocks.0.cross_attn.k_img.weight",
        "blocks.0.cross_attn.v_img.weight",
        "blocks.0.cross_attn.norm_k_img.weight",
        # MLPProj: LayerNorm / Linear / GELU / Linear / LayerNorm -> 0,1,3,4.
        "img_emb.proj.0.weight",
        "img_emb.proj.1.weight",
        "img_emb.proj.3.weight",
        "img_emb.proj.4.weight",
        # The control RMSNorm is already in FlashDreams layout.
        "patch_embedding.condition_norm.weight",
    }


def test_checkpoint_remap_still_applies_the_shared_table() -> None:
    remapped = game14b_dit_state_dict_from_diffusers(
        {
            "blocks.0.attn1.to_q.weight": torch.empty(0),
            "blocks.0.norm2.weight": torch.empty(0),
            "blocks.0.scale_shift_table": torch.empty(0),
            "scale_shift_table": torch.empty(0),
            "proj_out.weight": torch.empty(0),
        }
    )
    assert set(remapped) == {
        "blocks.0.self_attn.q.weight",
        # Diffusers' affine norm2 is FlashDreams' cross-attention norm3.
        "blocks.0.norm3.weight",
        "blocks.0.modulation",
        "head.modulation",
        "head.head.weight",
    }


def test_condition_frames_are_stacked_in_zero_to_one_rgb() -> None:
    """One condition render per latent frame, normalized to [0, 1]."""
    import numpy as np

    frames = [
        SimpleNamespace(
            condition_frame=(
                np.full((480, 832, 3), 255, dtype=np.uint8) if index % 4 == 0 else None
            )
        )
        for index in range(12)
    ]
    stacked = _stack_condition_frames(frames, expected=3)
    assert stacked.shape == (3, 3, 480, 832)
    assert stacked.dtype == torch.float32
    assert stacked.min() >= 0.0 and stacked.max() <= 1.0
    assert torch.allclose(stacked, torch.ones_like(stacked))


def test_condition_frame_count_must_match_the_chunk() -> None:
    import numpy as np

    frames = [
        SimpleNamespace(condition_frame=np.zeros((4, 4, 3), dtype=np.uint8))
        for _ in range(2)
    ]
    with pytest.raises(RuntimeError, match="condition frames"):
        _stack_condition_frames(frames, expected=3)
