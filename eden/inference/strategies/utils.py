from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from eden.inference.request import GenerationRequest
from eden.models.base import ModelAdapter
from eden.core.types import RuntimeContext


# Branch keys shared by every strategy that applies classifier-free guidance.
# ``cond`` is the fully conditioned branch, ``text`` keeps the positive prompt
# while neutralizing the model's control condition, and ``uncond`` is the
# negative-prompt branch (whose control is also neutralized).
CFG_BRANCH_COND = "cond"
CFG_BRANCH_TEXT = "text"
CFG_BRANCH_UNCOND = "uncond"


@dataclass(frozen=True)
class GuidanceSpec:
    """Resolved classifier-free-guidance configuration for one request.

    Two guidance axes are supported:

    ``text_scale`` (``inference.guidance_scale``) always steers the text prompt.
    ``control_scale`` (``inference.guidance_scale_proxy``) is optional and steers
    an adapter-declared non-text control condition -- for Proxy-DINO models the
    source-video control -- independently of the prompt.

    When ``control_scale`` is unset the historical joint-control behavior is
    preserved exactly: text and control move together in a single guidance term
    over two forwards. When it is set the two axes are decoupled::

        pred = [neg, zero]
             + text_scale    * ([pos, zero]    - [neg, zero])
             + control_scale * ([pos, nonzero] - [pos, zero])

    ``[pos, zero]`` is the intermediate branch, so decoupled guidance costs three
    forwards. When ``text_scale <= 1`` the negative branch drops out of the
    expression algebraically, so only two forwards are run.

    Note which setting is the neutral one.  Both expressions share the ``[neg,
    zero]`` anchor and differ by ``(text_scale - control_scale) * ([pos, nonzero]
    - [pos, zero])``, so decoupled guidance reproduces joint guidance exactly at
    ``control_scale == text_scale`` -- *not* at ``control_scale == 1``.  Setting
    ``control_scale = 1`` while ``text_scale > 1`` applies distinctly weaker
    control guidance than the joint default and will change generated output.
    """

    text_scale: float
    control_scale: float | None = None
    control_name: str | None = None

    @property
    def decoupled(self) -> bool:
        """Whether the control condition gets its own guidance term."""
        return self.control_scale is not None

    @property
    def text_active(self) -> bool:
        """Whether a negative-prompt branch is needed."""
        return self.text_scale > 1.0

    @property
    def enabled(self) -> bool:
        """Whether more than one forward per denoising step is required."""
        return self.text_active or self.decoupled

    def branch_keys(self) -> tuple[str, ...]:
        """Branches to evaluate, conditioned branch first.

        The order is deterministic so that sequence-parallel ranks issue their
        collectives in the same order.
        """
        keys = [CFG_BRANCH_COND]
        if self.decoupled:
            keys.append(CFG_BRANCH_TEXT)
        if self.text_active:
            keys.append(CFG_BRANCH_UNCOND)
        return tuple(keys)

    def fuse(self, predictions: dict[str, Any]):
        """Combine per-branch predictions into the guided prediction."""
        cond = predictions[CFG_BRANCH_COND]
        if not self.decoupled:
            if not self.text_active:
                return cond
            uncond = predictions[CFG_BRANCH_UNCOND]
            return uncond + self.text_scale * (cond - uncond)
        text = predictions[CFG_BRANCH_TEXT]
        guided = text
        if self.text_active:
            uncond = predictions[CFG_BRANCH_UNCOND]
            guided = uncond + self.text_scale * (text - uncond)
        return guided + self.control_scale * (cond - text)


def resolve_guidance(
    model: ModelAdapter,
    params: dict[str, Any],
    *,
    default_scale: float = 3.0,
    runtime_context: RuntimeContext | None = None,
) -> GuidanceSpec:
    """Build a :class:`GuidanceSpec` from request params.

    ``guidance_scale_proxy`` is only meaningful when the adapter's unconditional
    branch actually neutralizes a control condition; otherwise the extra term is
    identically zero and would silently cost an extra forward per step. Ask the
    adapter instead of inspecting model-family config from this generic layer.
    """
    text_scale = float(params.get("guidance_scale", default_scale))
    raw_control = params.get("guidance_scale_proxy")
    if raw_control is None:
        return GuidanceSpec(text_scale=text_scale)
    control_name = model.cfg_decoupled_control(runtime_context)
    if control_name is None:
        raise ValueError(
            "guidance_scale_proxy requires a model whose CFG-unconditional branch "
            f"neutralizes a non-text control condition, but {model.name!r} declares none. "
            "For Proxy-DINO models set model.proxy_dino.cfg_unconditional_control=zero, "
            "or drop guidance_scale_proxy to use joint text+control guidance."
        )
    return GuidanceSpec(
        text_scale=text_scale,
        control_scale=float(raw_control),
        control_name=control_name,
    )


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
