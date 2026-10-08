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
> `eden/configs/*.yaml` are not yet published. See
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

| | Requirement |
| --- | --- |
| Python | 3.10 – 3.12 (`>=3.10,<3.13`) |
| PyTorch | >= 2.6, CUDA build matching your driver |
| GPU | One NVIDIA GPU; >= 40 GB VRAM for 5B at 720p |
| OS | Linux x86-64 |

PyTorch has to be installed first and separately: the wheel depends on your driver's
CUDA version, so resolving it from the project metadata would pick the wrong build.

```bash
git clone xxx
cd eden

# cu128 shown; match the CUDA build to your driver.
pip install torch --index-url https://download.pytorch.org/whl/cu128

pip install -e ".[data]"
```

`[data]` adds `decord` (video decoding) and `pandas`/`pyarrow` (manifest reading), which
the manifest-driven inference path needs. Without it, only the prompt-driven path
(`inference.use_prompt_loader`) works.

The real-time streaming service under `realtime/` runs from the `wm` conda env
(80 GB VRAM) — see [`realtime/README.md`](realtime/README.md).

Optional: FlashAttention 4 for the fastest attention kernel. It is version
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

Each config points `model.pretrained_dir` at a directory holding one subdirectory per
component, in the Diffusers layout:

```
eden-wan21-14b-480p/
  tokenizer/        text_encoder/     vae/        scheduler/
  transformer/      image_encoder/    image_processor/     # I2V only
```

Components load one directory at a time with a fixed loader class per component, so no
`model_index.json` is read and the tree needs nothing beyond the directories above.
Directories must exist locally — nothing is pulled from the Hub. `transformer_2` (a
second expert) and the CLIP tower are optional and simply absent when their directory is.

To run a different DiT against the same VAE, T5 and CLIP, override that one component:

```yaml
model:
  pretrained_dir: /path/to/eden-wan21-14b-480p
  components:
    transformer:
      path: /path/to/our-dit
```

`model.pipeline_class` names the pipeline to assemble — `WanImageToVideoPipeline` for the
14B I2V line, `WanPipeline` for the 5B TI2V line — and `model.boundary_ratio` is the
dual-expert switchover point, `null` for every single-expert release. Both come from the
released checkpoint's own `model_index.json`; copy the values rather than guessing, since a
wrong `boundary_ratio` disables expert switching without an error.

### Quick start

Two proxy recordings ship with the repo under `examples/samples/`, with a manifest that
points at them:

```
examples/samples/
  manifest.csv          id, prompt, proxy_video, first_frame
  boxed-in/             cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  dead-rush/            same five files
```

Both recordings are 1280x704 and long enough for the shipped 81-frame 14B configs. The
commands below read them; point `data.dataset.params.*` at your own manifest to run your
own data.

`prompts.json` carries the full recording metadata — the `staticPrompt` used in the
manifest plus timed `dynamicPrompts` for the events in the clip. `prompts.txt` is the
same content, readable.

Two models ship, each in the same two inference modes. Every config in
`eden/configs/` is self-contained — one file, no includes:

| Mode | Wan2.1-I2V-14B @ 480p | Wan2.2-TI2V-5B @ 720p |
| --- | --- | --- |
| Bidirectional | `wan21_14b_480p_bidir.yaml` | `wan22_5b_720p_bidir.yaml` |
| Few-step | `wan21_14b_480p_few_step.yaml` | `wan22_5b_720p_few_step.yaml` |

The 14B commands below run the shipped recordings as-is; swap the `--config` for the 5B
column to run that model.

**Bidirectional** — all frames denoise jointly, highest quality:

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan21_14b_480p_bidir.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
```

**Few-step** — chunk-autoregressive, 4 steps per chunk, near real time:

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan21_14b_480p_few_step.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
```

The 5B configs generate at 1280x704. They read a 5-second window of the proxy by
default, which the two shipped recordings are longer than; pass
`duration_seconds=null` to take them as they are, or set it to the window you want:

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan22_5b_720p_bidir.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  data.dataset.params.columns.proxy_video.params.duration_seconds=null \
  runtime.sequence_parallel.size=2 \
```

**Streaming service** — interactive real-time inference. The proxy comes from a game
running in the browser instead of a recorded file, and frames are served over WebRTC as
they are generated. This path lives in [`realtime/`](realtime/):

```bash
cd realtime

# Settings — weight tree, addresses, ports, GPU count — live in deploy.conf.
# Edit it once; the scripts read it and take no arguments of their own.

# 1. TURN relay, on the GPU host. Media needs a UDP path the page load does
#    not, so a browser on another subnet cannot receive video without it. Set
#    TURN_SECRET in deploy.conf first, then TURN_HOST to the address this
#    prints. Leave TURN_HOST empty to skip the relay, which only works when
#    the browser shares the server's subnet.
bash turn_server.sh

# 2. Workbench bridge, on the machine that has the `claude` CLI. This is what
#    makes a new game from a text description. Skip it to only play the games
#    already in games/registry.json. `claude` must be on PATH, already logged in
#    (`claude auth login`) and past the first-run trust prompt — the bridge runs
#    it unattended with `--dangerously-skip-permissions` and has no key of its
#    own. Set EDEN_WORKBENCH_CLAUDE if the binary is not named `claude`.
bash workbench_bridge.sh

# 3. The model app, on the GPU host. The page opens on the workbench and
#    renders nothing until a game is picked. launch.sh starts the FLUX worker
#    itself (the photoreal first frame) and loads weights from MODEL_ROOT, so
#    no HF_HOME setup is needed. Activate your Python environment first.
bash launch.sh
```

Open `http://<host>:8089` (`APP_PORT` in `deploy.conf`). The page is a workbench: it
starts on a home screen listing the games, and nothing renders until you pick one.
Choosing a game loads it and begins streaming; when a round ends you can replay it or
go back and switch. `NPROC` sets how many ranks `torchrun` starts — one per GPU, so
set it to the number you want to use.

A fourth service, `workbench_bridge.sh`, is only needed to *generate* new games from
a text description; it runs where the `claude` CLI is installed. Playing the games
already in [`realtime/games/registry.json`](realtime/games/registry.json) does not
need it.

| Model | Application slug |
| --- | --- |
| 5B | `game2v-eden-world-v2-5b-taehv` |
| 14B | `game2v-eden-world-v2-14b-taehv` |

Both decode with the TAEHV decoder rather than the Wan VAE, trading some fidelity for
latency. `realtime/` carries its own `eden` package, unrelated to
the `eden/` package at the repo root — see [`realtime/README.md`](realtime/README.md) for
the service topology, the older non-workbench launcher, and the developer guides.

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

## Checking configs

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
- [ ] Replace the `/path/to/...` placeholders in `eden/configs/` — `model.proxy_dino.*`
      and the manifest paths — with the published locations.
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

The real-time streaming service under `realtime/` builds on
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams).

## License

Apache 2.0 — see [LICENSE](LICENSE). Model weights and the upstream Wan checkpoints carry
their own licenses. `realtime/` is also Apache 2.0 and keeps its own
[LICENSE](realtime/LICENSE) and [NOTICE](realtime/NOTICE).
