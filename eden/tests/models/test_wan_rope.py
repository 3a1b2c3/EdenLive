import pytest
import torch

from eden.models.adapters.wan22_diffusers.wan_ops import _apply_rotary_emb, _rotation_from_freqs


@pytest.mark.parametrize("dtype", [torch.float32, torch.bfloat16])
@pytest.mark.parametrize("device", ["cpu", "cuda"])
def test_rotary_emb_preserves_offline_complex_arithmetic(dtype, device):
    if device == "cuda" and not torch.cuda.is_available():
        pytest.skip("CUDA unavailable")
    generator = torch.Generator(device=device).manual_seed(42)
    hidden = torch.randn(1, 17, 3, 32, device=device, generator=generator).to(dtype)
    angles = torch.randn(1, 17, 1, 16, device=device, generator=generator)
    cos = angles.cos().repeat_interleave(2, dim=-1).to(dtype)
    sin = angles.sin().repeat_interleave(2, dim=-1).to(dtype)
    x1, x2 = hidden.unflatten(-1, (-1, 2)).unbind(-1)
    expected = torch.empty_like(hidden)
    expected[..., 0::2] = x1 * cos[..., 0::2] - x2 * sin[..., 1::2]
    expected[..., 1::2] = x1 * sin[..., 1::2] + x2 * cos[..., 0::2]
    rotation = torch.complex(cos[..., 0::2].float(), sin[..., 1::2].float())
    pairs = torch.view_as_complex(hidden.float().unflatten(-1, (-1, 2)))
    promoted = torch.view_as_real(pairs * rotation).flatten(-2).to(dtype)
    actual = _apply_rotary_emb(hidden, _rotation_from_freqs(cos, sin))
    assert actual.dtype == dtype
    assert torch.equal(actual, promoted)
    if dtype == torch.bfloat16:
        assert not torch.equal(actual, expected)
