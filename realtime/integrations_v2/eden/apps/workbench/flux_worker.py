# SPDX-License-Identifier: Apache-2.0
"""Long-lived FLUX.2 Klein coarse-to-fine worker.

The coarse-to-fine edit instruction and caption rules are vendored in
:mod:`eden.apps.workbench.flux_c2f_rules`. This worker loads the pipeline and
LoRA once and renders one image per request.

    CUDA_VISIBLE_DEVICES=1 python -m eden.apps.workbench.flux_worker --port 8092
"""

from __future__ import annotations

import argparse
import asyncio
import os
import time
from pathlib import Path
from typing import Any

from aiohttp import web
from loguru import logger

from eden.model_root import EDEN_MODEL_ROOT
from .flux_c2f_rules import EDIT_INSTRUCTION

WIDTH, HEIGHT = 1024, 576
"""The LoRA's training resolution."""
STEPS, GUIDANCE = 28, 4.0


def build_prompt(caption: str) -> str:
    """The fixed edit instruction plus the scene caption."""
    return f"{EDIT_INSTRUCTION} Scene: {caption.strip()}"


def _allowed_roots() -> list[Path]:
    games = os.environ.get("EDEN_GAMES_ROOT") or Path(__file__).resolve().parents[4] / "games"
    return [Path(games).resolve()]


def _inside_roots(path: Path) -> bool:
    resolved = path.resolve()
    return any(resolved.is_relative_to(root) for root in _allowed_roots())


class FluxRenderer:
    """One loaded pipeline; ``render`` is serialized by the caller.

    With ``offload`` (the default) the pipeline stays in host memory and each
    stage -- text encoder, transformer, VAE -- moves to the GPU only while it
    runs. The 14B app takes every GPU, so the worker shares one with a model
    rank: resident, the pipeline holds ~33 GiB and the rank's KV cache no
    longer fits. Offload costs a few seconds per render.
    """

    def __init__(self, offload: bool = True) -> None:
        import torch
        from diffusers import Flux2KleinPipeline

        started = time.perf_counter()
        self._torch = torch
        self.device = torch.device("cuda", 0)
        model_dir = f"{EDEN_MODEL_ROOT}/flux-c2f"
        self.pipe = Flux2KleinPipeline.from_pretrained(
            model_dir, torch_dtype=torch.bfloat16, local_files_only=True
        )
        if bool(getattr(self.pipe.config, "is_distilled", False)):
            raise ValueError("The canonical coarse-to-fine LoRA requires a base model")
        self.pipe.load_lora_weights(model_dir, weight_name="c2f_lora.safetensors")
        if offload:
            self.pipe.enable_model_cpu_offload(device=self.device)
        else:
            self.pipe.to(device=self.device)
        self.pipe.set_progress_bar_config(disable=True)
        # CPU offload can leave CUDA uninitialized; memory stats do not initialize it.
        torch.cuda.init()
        logger.info("FLUX c2f pipeline ready in {:.1f}s (offload: {})",
                    time.perf_counter() - started, offload)

    def render(self, coarse: Path, caption: str, seed: int, out: Path) -> dict[str, Any]:
        from PIL import Image, ImageOps

        with Image.open(coarse) as image:
            reference = ImageOps.fit(
                image.convert("RGB"), (WIDTH, HEIGHT),
                method=Image.Resampling.BICUBIC, centering=(0.5, 0.5),
            )
        started = time.perf_counter()
        self._torch.cuda.reset_peak_memory_stats(self.device)
        generator = self._torch.Generator(device=self.device).manual_seed(seed)
        try:
            generated = self.pipe(
                image=reference,
                prompt=build_prompt(caption),
                height=HEIGHT,
                width=WIDTH,
                num_inference_steps=STEPS,
                guidance_scale=GUIDANCE,
                generator=generator,
            ).images[0]
        finally:
            # Hand the cached blocks back so a model rank on this GPU can use them.
            self._torch.cuda.empty_cache()
        out.parent.mkdir(parents=True, exist_ok=True)
        temporary = out.with_name(f".{out.name}.tmp-{os.getpid()}")
        generated.save(temporary, format="PNG")
        temporary.replace(out)
        return {
            "image": str(out),
            "seconds": round(time.perf_counter() - started, 2),
            "peak_gb": round(self._torch.cuda.max_memory_allocated(self.device) / 2**30, 1),
        }


def make_app(renderer_factory) -> web.Application:
    """``renderer_factory`` is called once, off the event loop, at startup."""
    app = web.Application()
    state: dict[str, Any] = {"renderer": None, "error": None, "lock": asyncio.Lock()}

    async def load(_: web.Application) -> None:
        async def _load() -> None:
            try:
                state["renderer"] = await asyncio.to_thread(renderer_factory)
            except Exception as error:  # surfaced through /healthz
                logger.opt(exception=True).error("FLUX worker failed to load.")
                state["error"] = str(error)

        app["loader"] = asyncio.create_task(_load())

    async def health(_: web.Request) -> web.Response:
        status = "ready" if state["renderer"] else ("failed" if state["error"] else "loading")
        return web.json_response({"status": status, "error": state["error"], "busy": state["lock"].locked()})

    async def render(request: web.Request) -> web.Response:
        if state["renderer"] is None:
            raise web.HTTPServiceUnavailable(reason=state["error"] or "FLUX is still loading.")
        payload = await request.json()
        coarse = Path(str(payload.get("coarse", "")))
        out = Path(str(payload.get("out", "")))
        caption = str(payload.get("caption", "")).strip()
        seed = int(payload.get("seed", 12345))
        if not caption:
            raise web.HTTPBadRequest(reason="caption is required.")
        if not (_inside_roots(coarse) and coarse.is_file()) or not _inside_roots(out) or out.suffix != ".png":
            raise web.HTTPBadRequest(reason="coarse and out must be PNG paths inside the games root.")
        async with state["lock"]:
            result = await asyncio.to_thread(state["renderer"].render, coarse, caption, seed, out)
        return web.json_response(result)

    app.on_startup.append(load)
    app.router.add_get("/healthz", health)
    app.router.add_post("/render", render)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--offload", action=argparse.BooleanOptionalAction, default=True,
                        help="Keep the pipeline in host memory between stages (default). "
                             "--no-offload keeps it on the GPU, for a GPU of its own.")
    args = parser.parse_args()
    web.run_app(make_app(lambda: FluxRenderer(offload=args.offload)), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
