<div align="center">

# Eden

**Proxy-guided video world models: turn coarse 3D previews into photorealistic video.**

[![Project Page](https://img.shields.io/badge/Project-Page-blue)](xxx)
[![Paper](https://img.shields.io/badge/arXiv-xxx-b31b1b)](xxx)
[![Model](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Models-yellow)](xxx)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

[Project Page](xxx) · [Paper](xxx) · [Models](xxx) · [Demo](xxx)

**English** · [简体中文](README_zh.md)

By [Vast AI](xxx)

</div>

> **Placeholders.** Links marked `xxx` and the `/path/to/...` entries in
> `eden/configs/models/*.yaml` are not yet published. See
> [Before publishing](#before-publishing).

<div align="center">
  <video src="docs/assets/generated.mp4" width="100%" controls loop muted autoplay playsinline></video>
</div>

## Overview

Eden generates video from three inputs: a **text prompt**, a **first frame**, and a
**proxy control video**. The model keeps the proxy's layout, camera motion, and timing
while replacing its appearance with photorealistic detail. This makes the output
*directable*: you author the motion in a game engine or previz tool and let the model
render it.

Control is injected through a **vision encoder**: a post-trained DINOv3 encoder embeds
each proxy frame, and those features condition the diffusion transformer.

## Installation

Requires Python 3.10-3.12, CUDA, and one GPU with >=40GB for 5B at 720p.

```bash
git clone xxx
cd eden

# Install the CUDA build of PyTorch matching your driver first.
pip install torch --index-url https://download.pytorch.org/whl/cu128

pip install -e ".[data]"
```

`[data]` adds `decord` (video decoding) and `pandas`/`pyarrow` (manifest reading), which
the manifest-driven inference path needs.

Optional: FlashAttention 4 for the fastest teacher-forcing attention. It is version
sensitive — a `flash_attn`/`cutlass` mismatch surfaces as
`AttributeError: module 'cutlass.cute.core' has no attribute 'ThrMma'`. Pass
`model.teacher_forcing_attention_backend=triton` to fall back.

```bash
pip install -r requirements/wan22-fa4.txt   # see docs/zh/wan22-fa4.md
```

## Model weights

```bash
# TODO: publish weights and replace.
huggingface-cli download xxx --local-dir ./checkpoints
```

### Quick start

Two proxy recordings ship with the repo under `examples/samples/`, with a manifest that
points at them:

```
examples/samples/
  manifest.csv          id, prompt, proxy_video, first_frame
  boxed-in/             cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  dead-rush/            same five files
```

Both recordings are 1280x704 and long enough for the shipped 81-frame configs. The
commands below read them; point `data.dataset.params.*` at your own manifest to run your
own data.

`prompts.json` carries the full recording metadata — the `staticPrompt` used in the
manifest plus timed `dynamicPrompts` for the events in the clip. `prompts.txt` is the
same content, readable.

**Bidirectional** — all frames denoise jointly, highest quality:

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/inference/wan21_i2v_14b_480p_proxy_dino_to_real/bidir_same.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
  inference.checkpoint=/path/to/ckpts/14b_480p/bidir_same
```

**Few-step** — chunk-autoregressive, 4 steps per chunk, near real time:

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/inference/wan21_i2v_14b_480p_proxy_dino_to_real/sgf.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
  inference.checkpoint=/path/to/ckpts/14b_480p/sgf
```

**Streaming service** — interactive real-time inference. The proxy comes from a game
running in the browser instead of a recorded file, and frames are served over WebRTC as
they are generated. This path lives in [`realtime/`](realtime/), a trimmed fork of
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams) carrying only the Eden
`game2v` deployment:

```bash
cd realtime
uv sync --package flashdreams-eden --extra runners

# HF_HOME must hold the model weights; the script exports HF_HUB_OFFLINE=1.
bash start.sh eden-game2v-5b-taehv      # or eden-game2v-14b-taehv
```

Open `http://<host>:8089` and play. `start.sh` maps the model name to an application
slug, then runs `run.py` under `torchrun --nproc_per_node=8` in `webrtc` mode. Pass `off`
as the second argument (`bash start.sh eden-game2v-5b-taehv off`) to skip transformer
compilation when you only care about time-to-first-chunk.

| `start.sh` model | Application slug |
| --- | --- |
| `eden-game2v-5b-taehv` | `game2v-eden-world-v2-5b-taehv` |
| `eden-game2v-14b-taehv` | `game2v-eden-world-v2-14b-taehv` |

Both decode with the TAEHV decoder rather than the Wan VAE, trading some fidelity for
latency.
`EDEN_GAME` selects which game drives the proxy render — the slugs come from
[`realtime/games/registry.json`](realtime/games/registry.json), and `subway-run` is the
default:

```bash
EDEN_GAME=need-for-speed bash start.sh eden-game2v-5b-taehv
```

`realtime/` is a separate uv workspace with its own `eden` package (the FlashDreams
integration, unrelated to the `eden/` package at the repo root) — see
[`realtime/README.md`](realtime/README.md) for its architecture and developer guides.

Videos and the conditions used to produce them are written to
`<output_dir>/save/inference/<step>/`: the generated `.mp4`, the proxy control video, the
first frame, and the prompt — enough to audit what the model was actually given.

## Your own data

Inference reads a manifest (CSV/JSONL/JSON/parquet). One row is one generation request:

```csv
id,prompt,proxy_video,first_frame
shot_001,"a rainy neon city street at night",/data/shot_001/proxy.mp4,/data/shot_001/cover.png
```

```bash
python -m eden.scripts.infer --config CONFIG.yaml \
  data.dataset.params.path=/data/my_manifest.csv \
  data.dataset.params.root=/data \
  data.dataset.params.columns.proxy_video.params.sampling=fps \
  data.dataset.params.columns.proxy_video.params.fps=16 \
  data.dataset.params.columns.proxy_video.params.num_frames=117 \
  inference.num_frames=117
```

> **The proxy must be long enough to cover the generated clip.** Latent frames are
> `(num_frames - 1) / 4 + 1`, and chunk-AR consumes one proxy frame per latent frame. A
> 121-frame proxy covers 31 latent frames, so `inference.num_frames=117` (30 latent) fits
> and `237` (60 latent) does not — the run aborts with *"Proxy-DINO source timeline is
> shorter than latent chunk"* rather than silently reusing the last proxy frame.

## Configuration

Configs are YAML with a lightweight `defaults:` composition (no Hydra) plus dotlist
overrides. A config composes a model group, a runtime group, and a data group, then sets
the `inference:` block:

```yaml
defaults:
  - models: wan22_5b_proxy_dino_channel_concat
  - runtime: fsdp2_sp_kv
  - data: proxy_video_test

inference:
  strategy: chunk_causal      # or: diffusion
  checkpoint: /path/to/ckpts/step_013000
  height: 704
  width: 1280
  num_frames: 117
  chunk_size: 3               # chunk_causal only
  num_inference_steps: 30
  guidance_scale: 3.0
  seed: 42
```

Keys worth knowing:

| Key | Meaning |
| --- | --- |
| `inference.strategy` | `diffusion` (bidirectional) or `chunk_causal` (autoregressive) |
| `inference.checkpoint` | Sharded DCP directory or a single `.pt` file |
| `inference.checkpoint_source` | `model` (default) or `ema` for saved EMA weights |
| `inference.use_prompt_loader` | Skip the dataset; generate from `inference.prompt` |
| `inference.guidance_scale` | Text CFG scale |
| `inference.guidance_scale_proxy` | Separate CFG scale for the proxy control stream |
| `inference.chunk_size` | Latent frames per autoregressive chunk |
| `runtime.sequence_parallel.size` | Shard one sample's sequence across N GPUs |
| `runtime.kv_cache.context.max_latent_frames` | Sliding KV window for long rollouts |
| `model.teacher_forcing_attention_backend` | `triton` or `flash4` |

Any key can be overridden positionally:
`inference.num_frames=241 runtime.kv_cache.context.max_latent_frames=21`.

To confirm every shipped config still composes into a dispatchable run — it loads,
names a registered strategy and adapter, and asks for outputs the adapter can
produce — without needing weights or a GPU:

```bash
python -m eden.scripts.check
```

It is a static check. Changes to the model forward, the schedulers, or the cache
still need a real inference run.

## Before publishing

- [ ] Replace every `xxx` link: project page, paper, model repo, demo, clone URL.
- [ ] Publish weights and document the download.
- [ ] Replace the `/path/to/...` placeholders in `eden/configs/` with the published
      weight, checkpoint, and manifest locations.
- [ ] Add more example results alongside `docs/assets/generated.mp4`.
- [ ] Fill in the citation block.

## Citation

```bibtex
@article{xxx,
  title   = {xxx},
  author  = {xxx},
  journal = {xxx},
  year    = {xxx}
}
```

## Acknowledgements

Built on [Wan2.1 / Wan2.2](https://github.com/Wan-Video),
🤗 [Diffusers](https://github.com/huggingface/diffusers), and
[DINOv3](https://github.com/facebookresearch/dinov3).

## License

Apache 2.0 — see [LICENSE](LICENSE). Model weights and the upstream Wan checkpoints carry
their own licenses.
