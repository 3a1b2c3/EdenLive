from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from edenlive.inference.request import GenerationRequest
from edenlive.models.base import ModelAdapter
from edenlive.core.types import RuntimeContext


# Branch keys shared by every strategy that applies classifier-free guidance.
# ``cond`` is the fully conditioned branch and ``uncond`` the negative-prompt
# branch, whose control condition the adapter neutralizes.
CFG_BRANCH_COND = "cond"
CFG_BRANCH_UNCOND = "uncond"


@dataclass(frozen=True)
class GuidanceSpec:
    """Resolved classifier-free-guidance configuration for one request.

    ``text_scale`` (``inference.guidance_scale``) steers the prompt and the
    control condition together. At ``text_scale <= 1`` the negative branch drops
    out and a single forward per step is run.
    """

    text_scale: float

    @property
    def text_active(self) -> bool:
        """Whether a negative-prompt branch is needed."""
        return self.text_scale > 1.0

    def branch_keys(self) -> tuple[str, ...]:
        """Branches to evaluate, conditioned branch first.

        The order is deterministic so that sequence-parallel ranks issue their
        collectives in the same order.
        """
        if self.text_active:
            return (CFG_BRANCH_COND, CFG_BRANCH_UNCOND)
        return (CFG_BRANCH_COND,)

    def fuse(self, predictions: dict[str, Any]):
        """Combine per-branch predictions into the guided prediction."""
        cond = predictions[CFG_BRANCH_COND]
        if not self.text_active:
            return cond
        uncond = predictions[CFG_BRANCH_UNCOND]
        return uncond + self.text_scale * (cond - uncond)


def resolve_guidance(params: dict[str, Any], *, default_scale: float = 3.0) -> GuidanceSpec:
    """Build a :class:`GuidanceSpec` from request params."""
    return GuidanceSpec(text_scale=float(params.get("guidance_scale", default_scale)))


def prompts_from_request(request: GenerationRequest, *, required: bool = True) -> list[str]:
    """Extract the text prompts from a request's ``text`` condition.

    ``required=True`` raises when the condition is absent (chunk-causal needs a
    prompt); ``required=False`` returns an empty list (diffusion validates later).
    """
    payload = request.conditions.require("text") if required else request.conditions.get("text")
    if payload is None or payload.data is None:
        return []
    data = payload.data
    if isinstance(data, str):
        return [data]
    return list(data)


def image_condition_latents(
    model: ModelAdapter,
    request: GenerationRequest,
    batch_size: int,
    runtime_context: RuntimeContext | None,
    *,
    generator=None,
):
    """Encode an optional first-frame image condition into model-native latents.

    Returns ``None`` when the request carries no ``image`` condition (plain T2V). The
    concrete latent layout and normalization are the adapter's responsibility via
    ``encode_image_condition``; this helper only resolves the payload to a batched
    image tensor and delegates.
    """
    if not bool(request.params.get("use_image_condition", True)):
        return None
    payload = request.conditions.get("image")
    if payload is None or payload.data is None:
        return None
    if not hasattr(model, "encode_image_condition"):
        raise NotImplementedError(f"{model.name} does not support image-conditioned (TI2V) generation")

    import torch

    image = payload.data
    if torch.is_tensor(image) and image.ndim == 4 and image.shape[0] == batch_size:
        images = image
    elif isinstance(image, (list, tuple)):
        images = torch.stack([torch.as_tensor(item) for item in image], dim=0)
    else:
        single = image if torch.is_tensor(image) else torch.as_tensor(image)
        images = single.unsqueeze(0).expand(batch_size, *single.shape) if single.ndim == 3 else single
    images = _resize_image_condition(images, request)
    return model.encode_image_condition(
        images,
        runtime_context,
        generator=generator,
        num_frames=int(request.params.get("num_frames", 81)),
    )


def _resize_image_condition(images, request: GenerationRequest):
    """Match a dataset image condition to the requested generation resolution."""
    import torch.nn.functional as F

    height = request.params.get("height")
    width = request.params.get("width")
    if height is None or width is None or images.ndim != 4:
        return images
    target_size = (int(height), int(width))
    if tuple(images.shape[-2:]) == target_size:
        return images
    return F.interpolate(images.float(), size=target_size, mode="bicubic", align_corners=False).to(images.dtype)

def generator_from_params(params: dict, device):
    """Build a seeded torch generator, or pass through a caller-supplied one."""
    seed = params.get("seed")
    if seed is None:
        return params.get("generator")
    import torch

    generator = torch.Generator(device=device)
    generator.manual_seed(int(seed))
    return generator
