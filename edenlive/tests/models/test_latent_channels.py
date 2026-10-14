"""Generation noise must have the latent width, not the DiT input width.

These coincide on the T2V/TI2V bases (``in_channels == vae.z_dim``), so a bug here is
invisible on 5B. Wan2.1-I2V-14B declares ``in_channels: 36`` -- 16 noisy + 4 mask + 16
condition -- while only 16 channels are denoised. Allocating 36-channel noise there
over-shoots by 20, and the image-condition and proxy-control concats then push the
patch embedding past its weight width:

    RuntimeError: weight of size [5120, 1060, ...] expected input to have 1060
    channels, but got 1080 channels instead

1060 = 16 latent + 20 image condition + 1024 proxy control; 1080 is that plus the
duplicated 20. The failure surfaces deep in the first forward, so pin the width here.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from edenlive.models.adapters.wan22_diffusers.adapter import Wan22DiffusersAdapter


def _adapter_with(vae_z_dim, transformer_in_channels):
    model = Wan22DiffusersAdapter({"dry_run": True})
    model.components = {
        "vae": SimpleNamespace(config=SimpleNamespace(z_dim=vae_z_dim)) if vae_z_dim else None,
        "transformer": SimpleNamespace(config=SimpleNamespace(in_channels=transformer_in_channels)),
    }
    return model


@pytest.mark.parametrize(
    "z_dim,in_channels,expected",
    [
        # Wan2.1-I2V-14B: the two differ and only z_dim is the denoised width.
        (16, 36, 16),
        # Wan2.2 TI2V-5B: they agree, so the choice is unobservable.
        (48, 48, 48),
    ],
)
def test_latent_channels_prefers_vae_z_dim(z_dim, in_channels, expected):
    assert _adapter_with(z_dim, in_channels)._latent_channels() == expected


def test_latent_channels_falls_back_to_in_channels_without_a_vae():
    """A VAE-less adapter (custom pipelines) still needs a usable width."""

    assert _adapter_with(None, 36)._latent_channels() == 36


def test_latent_channels_is_used_for_generation_noise():
    """Guard the call site, not just the helper.

    `prepare_generation_latents` previously read `transformer.config.in_channels`
    directly; that is the regression this test exists to catch.
    """

    import inspect

    src = inspect.getsource(Wan22DiffusersAdapter.prepare_generation_latents)
    assert "_latent_channels()" in src, "generation noise must use _latent_channels()"
    assert "config.in_channels" not in src, (
        "prepare_generation_latents must not size noise from transformer.config.in_channels; "
        "on Wan I2V that is the 36-channel DiT input width, not the 16-channel latent width"
    )
