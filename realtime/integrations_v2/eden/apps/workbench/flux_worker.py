# SPDX-License-Identifier: Apache-2.0
"""Long-lived FLUX.2 Klein coarse-to-fine worker.

The skill's ``infer_coarse_to_fine.py`` is a one-shot batch job that reloads
~34 GB of weights per run. This worker loads the pipeline and LoRA once and
renders one image per request. Constants (model, LoRA, edit instruction) come
from the skill script itself so the two cannot drift; the load and call block
mirrors its ``main()``.

    CUDA_VISIBLE_DEVICES=1 python -m eden.apps.workbench.flux_worker --port 8092
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import os
import time
from pathlib import Path
from types import ModuleType
from typing import Any

from aiohttp import web
from loguru import logger

from eden.model_root import EDEN_MODEL_ROOT

SKILL_SCRIPT = Path(os.environ.get("EDEN_FLUX_C2F_SCRIPT", ""))
"""The coarse-to-fine skill's inference script.

Set ``EDEN_FLUX_C2F_SCRIPT`` to it. There is no default: the script lives in
the FLUX fine-tuning repo, which is not vendored here.
"""
WIDTH, HEIGHT = 1024, 576
"""The LoRA's training resolution (the skill's defaults)."""
STEPS, GUIDANCE = 28, 4.0


def load_skill_module(path: Path = SKILL_SCRIPT) -> ModuleType:
    """Import the skill's inference script for its constants, without running it."""
    if not str(path):
        raise RuntimeError(
            "set EDEN_FLUX_C2F_SCRIPT to the coarse-to-fine skill's "
            "infer_coarse_to_fine.py"
        )
    spec = importlib.util.spec_from_file_location("flux_c2f_infer", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_prompt(skill: ModuleType, caption: str) -> str:
    """The skill's fixed edit instruction plus the scene caption, as in its main()."""
    return f"{skill.EDIT_INSTRUCTION} Scene: {caption.strip()}"


def _allowed_roots() -> list[Path]:
    games = os.environ.get("EDEN_GAMES_ROOT") or Path(__file__).resolve().parents[4] / "games"
    return [Path(games).resolve()]


def _inside_roots(path: Path) -> bool:
    resolved = path.resolve()
    return any(resolved.is_relative_to(root) for root in _allowed_roots())


class FluxRenderer:
    """One loaded pipeline; ``render`` is serialized by the caller."""

    def __init__(self, skill: ModuleType) -> None:
        import torch
        from diffusers import Flux2KleinPipeline

        started = time.perf_counter()
        self._torch = torch
        self.device = torch.device("cuda", 0)
        # The published tree is a diffusers layout (one shard per component),
        # so the worker loads it directly instead of the skill's bundle paths.
        model_dir = f"{EDEN_MODEL_ROOT}/flux-c2f"
        self.pipe = Flux2KleinPipeline.from_pretrained(
            model_dir, torch_dtype=torch.bfloat16, local_files_only=True
        )
        if bool(getattr(self.pipe.config, "is_distilled", False)):
            raise ValueError("The canonical coarse-to-fine LoRA requires a base model")
        self.pipe.to(device=self.device, dtype=torch.bfloat16)
        self.pipe.load_lora_weights(model_dir, weight_name="c2f_lora.safetensors")
        self.pipe.set_progress_bar_config(disable=True)
        self.skill = skill
        logger.info("FLUX c2f pipeline ready in {:.1f}s", time.perf_counter() - started)

    def render(self, coarse: Path, caption: str, seed: int, out: Path) -> dict[str, Any]:
        from PIL import Image, ImageOps

        with Image.open(coarse) as image:
            reference = ImageOps.fit(
                image.convert("RGB"), (WIDTH, HEIGHT),
                method=Image.Resampling.BICUBIC, centering=(0.5, 0.5),
            )
        started = time.perf_counter()
        generator = self._torch.Generator(device=self.device).manual_seed(seed)
        generated = self.pipe(
            image=reference,
            prompt=build_prompt(self.skill, caption),
            height=HEIGHT,
            width=WIDTH,
            num_inference_steps=STEPS,
            guidance_scale=GUIDANCE,
            generator=generator,
        ).images[0]
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
    args = parser.parse_args()
    skill = load_skill_module()
    web.run_app(make_app(lambda: FluxRenderer(skill)), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
