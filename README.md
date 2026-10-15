<div align="center">

# Eden

**EdenLive: Real-Time Generative Rendering from Any Reference**

[![Project Page](https://img.shields.io/badge/Project-Page-blue)](xxx)
[![Paper](https://img.shields.io/badge/arXiv-xxx-b31b1b)](xxx)
[![Model](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Models-yellow)](xxx)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

[Project Page](xxx) · [Paper](xxx) · [Models](xxx) · [Demo](xxx)

**English** · [简体中文](README_zh.md)

By [Vast AI](xxx)

</div>

> **Placeholders.** Links marked `xxx` and the weight download are not yet
> published. See [Before publishing](#before-publishing).

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

One Python environment runs both the offline inference in `edenlive/` and the
real-time service in `realtime/`. The versions below are the ones in the environment
this release was verified in:

| | Verified version |
| --- | --- |
| OS / GPU | Linux x86-64, NVIDIA GPUs with 80 GB (CUDA 13 driver) |
| Python | 3.10 |
| PyTorch | `2.14.0.dev20260717+cu130` nightly (`realtime/requirements.txt` pins `2.13.0`, cu130), torchvision 0.28.0 |
| diffusers / transformers / accelerate | 0.39.0 / 5.12.1 / 1.0.1 |
| decord / pandas / pyarrow | 0.6.0 / 2.3.3 / 25.0.1 |
| imageio / imageio-ffmpeg | 2.37.4 / 0.6.0 |
| Node.js | 22 (only to fetch three.js for the game renders) |

Install in this order. PyTorch comes first and from the CUDA index, and every
in-tree package goes in with `--no-deps`: their declared requirements would
otherwise let pip replace the CUDA build of torch with a PyPI one.

```bash
git clone xxx EdenLive
cd EdenLive

conda create -n edenlive python=3.10 -y
conda activate edenlive

# 1. PyTorch for a CUDA 13 driver (use .../whl/cu128 for CUDA 12.8).
pip install torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu130

# 2. The real-time service and its pinned dependencies.
cd realtime
pip install --no-deps -e ./flashdreams -e ./apps/cam2v -e ./integrations_v2/eden
pip install -r requirements.txt
python -m playwright install chromium
npm install --prefix games
cd ..

# 3. Offline inference: manifest reading and video I/O, then this package.
pip install decord==0.6.0 pandas==2.3.3 pyarrow==25.0.1 imageio==2.37.4 imageio-ffmpeg==0.6.0
pip install --no-deps -e .
```

The root package imports as `edenlive`. `realtime/` installs a separate package
that imports as `eden` (the FlashDreams integration); the two do not import each
other.

The default 5B bidirectional profile uses FA4 temporal text
attention and requires SM90, BF16, `flash-attn-4==4.0.0b31`, and
`nvidia-cutlass-dsl==4.7.1`. Use `--no-deps` when installing kernels into an
existing environment to preserve PyTorch. See [`docs/zh/wan22-fa4.md`](docs/zh/wan22-fa4.md).

## Model weights

```bash
# TODO: publish weights and replace.
huggingface-cli download xxx --local-dir ./models/EdenLive
```

Everything loads from one directory, `models/EdenLive` under the repository root by
default (about 210 GB in total). Nothing is pulled from the Hub at run time.

```
models/EdenLive/
  dit-14b/            diffusion_pytorch_model.safetensors, config.json  14B few-step (chunk-AR) DiT
  dit-14b-bidir/      diffusion_pytorch_model.safetensors, config.json  14B bidirectional DiT
  dit-5b/             diffusion_pytorch_model.safetensors, config.json  5B few-step (chunk-AR) DiT
  dit-5b-bidir/       diffusion_pytorch_model.safetensors, config.json  5B bidirectional DiT
  vae-14b/            Wan2.1_VAE.pth, config.json
  vae-5b/             Wan2.2_VAE.pth, config.json
  decoder-14b/        lighttaew2_1.pth                    TAEHV decoder (real-time only)
  decoder-5b/         lighttaew2_2.pth                    TAEHV decoder (real-time only)
  scheduler-14b/      scheduler_config.json               offline only
  scheduler-5b/       scheduler_config.json               offline only
  umt5/               text_encoder/, tokenizer/           UMT5 text encoder
  clip/               image_encoder/, image_processor/    CLIP, 14B I2V only
  vision-encoder/     backbone/, projection.safetensors   proxy-DINO encoder
  flux-c2f/           Diffusers FLUX tree + c2f_lora.safetensors   workbench first frame (real-time only)
```

The offline configs set `model.pretrained_dir: models/EdenLive`, a path relative to
the working directory, and name each component under it (`model.components.*.path`).
Run from the repository root, or point it elsewhere:

```bash
python -m edenlive.scripts.infer --config ... model.pretrained_dir=/data/EdenLive
```

To run a different DiT against the same VAE, T5 and CLIP, override that one component:

```yaml
model:
  components:
    transformer:
      path: /path/to/our-dit     # absolute, or relative to pretrained_dir
```

`model.pipeline_class` names the pipeline to assemble — `WanImageToVideoPipeline` for
the 14B I2V line, `WanPipeline` for the 5B TI2V line.

The real-time service reads the same tree through `MODEL_ROOT` in
[`realtime/deploy.conf`](realtime/deploy.conf).

### Quick start

Two proxy recordings ship with the repo under `examples/samples/`, with a manifest that
points at them:

```
examples/samples/
  manifest.csv        id, prompt, proxy_video, first_frame
  cryo-crossing/       cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  pulse-skirmish/      same five files
```

`recording.mp4` is the greybox proxy (1280x704) and `first-frame.png` its first frame.
`cover.png` is the photoreal render of that frame, and it is what the manifest feeds the
model as `first_frame`. `prompts.json` carries the full recording metadata — the
`staticPrompt` used in the manifest plus timed `dynamicPrompts`; `prompts.txt` is the
same content, readable.

The two samples are recordings of the bundled games:

| Sample | Scene |
| --- | --- |
| `cryo-crossing` — Cryo Crossing | Freeze stepping stones across a lava lake with a cryo-blaster. |
| `pulse-skirmish` — Pulse Skirmish | Fight combat robots with twin pulse pistols along a sunlit street. |

Both recordings contain 717 frames at 24 FPS (29.875 seconds). Every inference input —
proxy video, reference image and prompt JSON — is bundled here, so the samples run
straight from this checkout. Few-step inference processes both full recordings by
default; bidirectional inference uses the frame limits below.

Two models ship, each in two inference modes. Every config in
`edenlive/configs/` is self-contained — one file, no includes:

| Mode | Wan2.1-I2V-14B @ 480p | Wan2.2-TI2V-5B @ 720p |
| --- | --- | --- |
| Bidirectional | `wan21_14b_480p_bidir.yaml` | `wan22_5b_720p_bidir.yaml` |
| Few-step (chunk-AR) | `wan21_14b_480p_few_step.yaml` | `wan22_5b_720p_few_step.yaml` |

Every config already points at `examples/samples/manifest.csv`, so the commands below
run from the repository root as they are.

**Bidirectional** — all frames denoise jointly, highest quality:

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_bidir.yaml \
  runtime.sequence_parallel.size=2
```

**Few-step** — chunk-autoregressive, 4 steps per chunk, near real time:

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_few_step.yaml \
  runtime.sequence_parallel.size=2
```

The 5B profiles generate 1280x704 on one GPU. Bidirectional inference samples
the beginning of the recording at timestamp-aligned intervals, capped at 121
frames; few-step inference uses its full duration. The corresponding 14B cap
is 81 frames. Both few-step profiles use fixed-window RoPE with a total window
of 18 latent frames, including 6 sink frames and the current chunk of 3.

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_bidir.yaml
```

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_few_step.yaml
```

Videos and the conditions used to produce them are written to
`<inference.output_dir>/save/inference/base/` (`inference/<config name>/` by default):
the generated `.mp4`, the proxy control video, the first frame, and the prompt.
Filenames use the manifest `id` (for example, `cryo-crossing.mp4`). Only the first
rank in each sequence-parallel group saves artifacts.
The default `recording_manifest` dataset reads static prompts and timed events
from each recording's `prompts.json` and saves input indices, requests, and
resolved configurations. The 14B bidirectional profile loads its weights
from `dit-14b-bidir`.

**Streaming service** — interactive real-time inference. The proxy comes from a game
running in the browser instead of a recorded file, and frames are served over WebRTC as
they are generated. This path lives in [`realtime/`](realtime/); its settings — weight
tree, addresses, ports, GPU count — live in
[`realtime/deploy.conf`](realtime/deploy.conf), and the scripts read it.

To play the games already in [`realtime/games/registry.json`](realtime/games/registry.json),
one command on the GPU host is enough — it needs neither the workbench bridge nor the
FLUX worker:

```bash
cd realtime
bash start.sh 14b      # or 5b; renders GAME from deploy.conf from the first step
```

The game library includes Cryo Crossing (`freeze`, the default), Spider Hollow
(`spiders`), Pulse Skirmish (`tracer`), Deepwater Shock (`deepwater-shock`), Kaiju Rampage
(`kaiju-rampage`), Arcade Duel (`arcadeduel`), and Desert Crossfire (`desert-crossfire`). These
interactive games include their own reference frames and starting states.


The workbench — a game library, a chat that builds new games from a text description,
and a play window — needs all four services. Its first-frame renderer (the FLUX worker)
runs FLUX.2 \[klein\] 9B under the FLUX Non-Commercial License, so the workbench is
**for non-commercial use only**, and that license requires content filtering on the
images it generates (see [License](#license)). Playing registered games with `start.sh`
does not load FLUX.

```bash
cd realtime

# 1. TURN relay, on the GPU host. Media needs a UDP path the page load does not,
#    so a browser on another subnet cannot receive video without it. Set
#    TURN_SECRET in deploy.conf first, then TURN_HOST to the address this prints.
#    Leave TURN_HOST empty to skip the relay (browser on the server's subnet only).
bash turn_server.sh

# 2. Workbench bridge, on the machine that has the `claude` CLI (logged in with
#    `claude auth login` and past the first-run trust prompt; it runs unattended
#    with --dangerously-skip-permissions). It writes the shared token to
#    .workbench/token; copy that file to the GPU host if it is another machine,
#    and set BRIDGE_HOST there. On a single machine leave BRIDGE_HOST empty.
bash workbench_bridge.sh

# 3. FLUX worker, on the GPU host. Renders the photoreal first frame.
bash workbench_flux.sh

# 4. The model app, on the GPU host. Starts the FLUX worker itself if step 3 was
#    skipped, and refuses to start without .workbench/token.
bash launch.sh

# Stop whatever this host started.
bash stop.sh
```

Open `http://<host>:8089` (`APP_PORT` in `deploy.conf`). The page has three parts,
and nothing renders until you press play:

- **Game library** -- every registered game as a card. Clicking one opens it in the
  play window; games made in the workbench can also be reopened there.
- **Workbench** -- a chat on the left and the result on the right. The first message
  describes a game and builds it; later messages revise the same game. The right side
  has a tab to try the proxy game in the browser and a tab to caption and render its
  photoreal first frame. **New game** starts a new conversation.
- **Play window** -- an overlay over the page that streams the model's video. Closing
  it stops rendering; when a round ends you can replay or close.

`NPROC` sets how many ranks `torchrun` starts — one per GPU.

| Model | Application slug |
| --- | --- |
| 5B | `game2v-eden-world-v2-5b-taehv` |
| 14B | `game2v-eden-world-v2-14b-taehv` |

Both decode with the TAEHV decoder rather than the Wan VAE, trading some fidelity for
latency. See [`realtime/README.md`](realtime/README.md) for the service topology and the
developer guides.

## Your own data

The default profiles read a recording manifest (CSV/JSONL/JSON/parquet), one
recording per request. Each directory contains `recording.mp4`, `cover.png`,
and `prompts.json`; text comes from `staticPrompt` and `dynamicPrompts`:

```csv
id,proxy_video,first_frame
shot_001,shot_001/recording.mp4,shot_001/cover.png
```

```bash
python -m edenlive.scripts.infer --config CONFIG.yaml \
  data.dataset.params.path=/data/my_manifest.csv \
  data.dataset.params.root=/data
```

Frame count comes from recording timestamps and profile FPS, rounded down to
`1 mod 4`. Override `data.dataset.params.max_frames` to shorten a clip, preserving
the configured limits for bidirectional profiles. The original `manifest` dataset
remains available for separate configurations with general prompt/video inputs.

## Before publishing

- [ ] Replace every `xxx` link: project page, paper, model repo, demo, clone URL.
- [ ] Publish the `models/EdenLive` tree and fill in the download command.
- [ ] Add more example results alongside `docs/assets/generated.mp4`.
- [ ] Fill in the citation authors, venue, and link.

## Citation

```bibtex
@article{edenlive2026,
  title   = {EdenLive: Real-Time Generative Rendering from Any Reference},
  author  = {xxx},
  journal = {xxx},
  year    = {2026}
}
```

## Acknowledgements

Built on [Wan2.1 / Wan2.2](https://github.com/Wan-Video),
🤗 [Diffusers](https://github.com/huggingface/diffusers),
[DINOv3](https://github.com/facebookresearch/dinov3),
[FLUX.2 \[klein\]](https://bfl.ai/models/flux-2-klein) by Black Forest Labs, and the
[LightX2V](https://huggingface.co/lightx2v/Autoencoders) LightTAE decoders. The game
renders use [three.js](https://threejs.org), and the workbench's game-generation skill
builds on [GameBlocks](https://github.com/xt4d/GameBlocks).

The real-time streaming service under `realtime/` builds on
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams).

## License

First-party code is licensed under Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
`realtime/` is also Apache 2.0 and keeps its own [LICENSE](realtime/LICENSE),
[NOTICE](realtime/NOTICE) and [THIRD-PARTY-NOTICES](realtime/THIRD-PARTY-NOTICES).
The vendored html-to-image bundle and GameBlocks-derived skill modules retain
their MIT licenses and original copyright notices; per-file scope is recorded
in [REUSE.toml](realtime/REUSE.toml).

The model weights are distributed separately and are **not** all Apache 2.0:

| Component | License |
| --- | --- |
| `dit-*`, `vae-*`, `umt5/`, `scheduler-*`, `decoder-*` | Apache 2.0 |
| `clip/` (LAION CLIP ViT-H/14 / OpenCLIP) | [MIT](https://huggingface.co/laion/CLIP-ViT-H-14-laion2B-s32B-b79K) |
| `vision-encoder/` (DINOv3 and derivatives) | [DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) |
| `flux-c2f/` (FLUX.2 \[klein\] 9B plus our LoRA; workbench first frame only) | [FLUX Non-Commercial License](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/blob/main/LICENSE.md) — non-commercial, non-production use only |

FLUX public end-user or production deployment is not automatically permitted by
being free of charge or described as a demo; check the license and obtain a
separate authorization from Black Forest Labs where required. These restrictions
apply to the model and LoRA, not to independently Apache-licensed project code.

Each component ships its own license and notice files alongside the weights; see the model
repository's README for details.
