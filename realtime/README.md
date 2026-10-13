<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# FlashDreams — Eden game2v deployment

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
</p>

A trimmed fork of [NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams)
carrying only what the two **Eden game2v** models need to serve interactive
sessions: the `eden` integration, the framework code it imports, and the game
renders that drive it.

This tree is the real-time serving path for [Eden](../README.md) and lives inside
that repository. Its `eden` package is the FlashDreams integration, which is a
different package from the `eden/` at the Eden repository root, and neither
imports the other. It is installed with pip from [`requirements.txt`](requirements.txt).

FlashDreams itself is a high-performance inference and serving library for
interactive autoregressive video and world models. For every other model, the
full documentation, and the developer guides, use upstream.

## System Requirements

- NVIDIA GPU with **80 GB VRAM or more** (e.g. H100 80GB), see notes below.
- NVIDIA driver from the **R580 series or newer** (default compatible with CUDA 13.x)
- **CUDA 13.x** (PyTorch `2.13.0+cu130`, the build [`requirements.txt`](requirements.txt)
  is pinned against; a CUDA 12.8 driver takes the `cu128` wheel index instead)
- **Python >= 3.10**
- **PyTorch >= 2.9** (2.13.0 verified), with a matching torchvision
- Linux x86-64 or arm64
- **100 GB+ free storage space** recommended for environment and model checkpoints.
- Docker with the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  (optional, only for the container workflow)

> Development and testing were performed on GPUs with **80 GB of VRAM or more**.
> Inference can fail (out-of-memory) on consumer and even enthusiast GPUs.
> Per-model GPU and VRAM requirements are listed on each model page in
> [the model gallery](https://nvidia.github.io/flashdreams/main/models/index.html).

## Quickstart

The launch scripts call whatever `python` and `torchrun` are on `PATH` and set
up nothing of their own, so install into the environment you will activate
before launching. `torch` has to come first and from the wheel index matching
your driver; `requirements.txt` then installs the rest, including this tree:

```bash
cd realtime
pip install torch==2.13.0 torchvision==0.28.0 \
    --index-url https://download.pytorch.org/whl/cu130
pip install --no-deps -e ./flashdreams -e ./apps/cam2v \
    -e ./integrations_v2/eden
pip install -r requirements.txt
python -m playwright install chromium
```

`cu130` matches a CUDA 13 driver; use `https://download.pytorch.org/whl/cu128`
for CUDA 12.8, with the torchvision build of the same torch release. Chromium
is what captures the proxy game, both for the cover image and for the frames
the model conditions on. `three.js` is not in the tree (`games/node_modules` is
git-ignored); the renderer serves it from `games/node_modules/three`, pinned to
0.161.0:

```bash
npm install --prefix games three@0.161.0
```

Everything deployment-specific -- where the weights are, which addresses and
ports the services bind, how many GPUs to use -- lives in
[`deploy.conf`](deploy.conf). Edit it once; the scripts read it and take no
arguments. To keep a second deployment, copy `deploy.conf` to
`deploy.local.conf` (git-ignored): when that file exists it is sourced after
`deploy.conf` and its values win.

Weights come from `MODEL_ROOT` in that file (see below), not from Hugging Face.

### Launch the workbench

The page is a workbench in three parts, and nothing renders until a game is
played. The game library (`#/`) lists every registered game. The workbench
(`#/studio/<id>`) is a conversation: the first message builds a game, later
ones revise it, and the right side tries the proxy game and renders its
photoreal first frame. The play window is an overlay that streams the model's
video and stops rendering when closed. Conversations are stored by the bridge
in `.workbench/conversations/`.
Four services, in this order -- the first three are independent of each other,
the app wants them up first.

```bash
# 1. TURN relay, on the GPU host. A browser outside the server's subnet has no
#    direct UDP path to it, and its connection stalls without the relay. Set
#    TURN_SECRET in deploy.conf first; this prints the address to put in
#    TURN_HOST.
bash turn_server.sh

# 2. Workbench bridge, on the host that has the `claude` CLI. It runs the
#    game-generation jobs. `claude` must be on PATH, already logged in
#    (`claude auth login`) and past the first-run trust prompt: the bridge runs
#    it unattended with `--dangerously-skip-permissions` and has no key of its
#    own. Set EDEN_WORKBENCH_CLAUDE if the binary is not named `claude`.
#    The bridge writes the shared token both sides use to .workbench/token;
#    this prints the address to put in BRIDGE_HOST.
bash workbench_bridge.sh

# 3. FLUX worker, on the GPU host. Renders the photoreal first frame.
bash workbench_flux.sh            # or `bash workbench_flux.sh <gpu>`

# 4. The model app, on the GPU host. Starts the FLUX worker itself when it is
#    not already running.
bash launch.sh

# Stop everything this host is running: the app, the FLUX worker,
# the bridge and the relay. Run it on each host that has services up.
bash stop.sh
```

Then open `APP_PORT` (8089 by default) on the GPU host. `NPROC` sets how many
ranks `torchrun` starts, one per GPU -- set it to the number of GPUs you want to
use. `GAME` picks which cover the session falls back to; the slugs come from
[`games/registry.json`](games/registry.json) and default to `subway-run`.

When the bridge and the app are on different hosts, copy `.workbench/token`
from the bridge to the app's `realtime/` directory: both sides authenticate
with it, and the app refuses to start without it.

Weights live in one directory, `MODEL_ROOT` in [`deploy.conf`](deploy.conf),
which defaults to `models/EdenLive` under the repository root. A relative path
there is read from the repository root. The realtime pipeline configs
([`integrations_v2/eden/configs/`](integrations_v2/eden/configs)) can pin the
tree themselves with their own `model_root`, which wins over `deploy.conf`. The
tree is the Hugging Face repo layout: `dit-5b/`,
`dit-14b/`, `dit-5b-bidir/`, `dit-14b-bidir/`, `umt5/`, `vae-5b/`, `vae-14b/`,
`decoder-5b/`, `vision-encoder/`, `flux-c2f/` and `clip/`. The two `*-bidir/`
directories hold the bidirectional base DiT weights; no serving config loads
them, the realtime pipelines use `dit-5b/` and `dit-14b/`. Everything is loaded
with `HF_HUB_OFFLINE=1`.

Making or revising a game takes tens of minutes (an agent writes and plays
it), so the conversation and its job log survive a page reload. Picking an existing game
takes a few seconds. `launch.sh` logs to `.eden_app.log`.

### How the four services fit together

```
browser ──8089──> model app (GPU server, rank 0)
                    │  /ext/workbench/  proxied, token-authenticated
                    ├──8091──> bridge      (host with the `claude` CLI)
                    └──8092──> FLUX worker (GPU server: first-frame render)
browser <──3478──── TURN relay (media path for off-subnet clients)
```

Rank zero owns the browser-facing side: the page, the Chromium proxy render,
and the `/ext/workbench/` proxy. The bridge runs wherever the `claude` CLI is
installed, which need not be the GPU server, and it is reached with a shared
token written to `.workbench/token` on its first run (`launch.sh` reads the
same file).

The TURN relay is the one that fails quietly. Media needs a UDP path the page
load does not, so a client on another subnet has no route to the server without
it. An address pointing at a relay that is not there is worse than none: the
browser stalls in "gathering candidates" for ten seconds and then fails,
instead of falling back. `turn_server.sh` is not supervised -- it needs
starting again after a host restart. Leave `TURN_HOST` unset to skip the relay
entirely, which only works when the browser and the server share a subnet.

### Without the workbench

`start.sh` is the older path: it renders from the first step with no home
screen and no generation, and needs neither the bridge nor the FLUX worker.

```bash
bash start.sh 5b      # or 14b; defaults to MODEL in deploy.conf
```

It reads the same `deploy.conf`. A second argument of `--no-compile` skips
transformer compilation, for when only time-to-first-chunk matters.

## Supported models

This is a deployment-only fork: it carries the two Eden game2v models and the
framework code they need, nothing else. For the full model gallery, see
[upstream FlashDreams](https://github.com/NVIDIA/flashdreams).

| Application slug | Model |
| --- | --- |
| `game2v-eden-world-v2-5b-taehv` | Eden game2v 5B, TAEHV decoder |
| `game2v-eden-world-v2-14b-taehv` | Eden game2v 14B, TAEHV decoder |

Both decode with LightTAE rather than the Wan VAE. The non-TAEHV pipeline
configs stay in `game5b_config.py` and `game14b_config.py` because the two
shipped variants are `derive_config`'d from them, but they are not registered as
applications and cannot be launched.

The `cam2v-eden-*` slugs in
[`integrations_v2/eden/pyproject.toml`](integrations_v2/eden/pyproject.toml) are
kept because `game2v` shares their conditioning code.


## Contributing

Send changes to [upstream FlashDreams](https://github.com/NVIDIA/flashdreams).
This fork exists to deploy the Eden game2v models and is not the place for new
integrations.

Use [GitHub Issues](https://github.com/NVIDIA/flashdreams/issues) to report defects or request improvements.

Join us on the [NVIDIA Omniverse Discord](https://discord.com/invite/nvidiaomniverse)
to share your results and take part in technical discussion! Channel: [`#flashdreams`](https://discord.gg/cMt2mHm4aN)

## Security

To report a potential security vulnerability, follow the coordinated
disclosure process in [`SECURITY.md`](SECURITY.md).

## License

FlashDreams is released under the [Apache License 2.0](LICENSE). Third-party
components and their licenses are listed in
[`THIRD-PARTY-NOTICES`](THIRD-PARTY-NOTICES) and [`NOTICE`](NOTICE). The
repository is REUSE-compliant; see [`REUSE.toml`](REUSE.toml) and
[`LICENSES/`](LICENSES/).

## Citation

If FlashDreams is useful in your research or product, please cite the project:

```bibtex
@misc{flashdreams2026,
  title        = {FlashDreams: High-performance inference and serving for
                  interactive autoregressive video and world models},
  author       = {{FlashDreams Contributors}},
  year         = {2026},
  howpublished = {\url{https://github.com/NVIDIA/flashdreams}},
}

@misc{nvidia2026omnidreams,
  title         = {{NVIDIA} {OmniDreams}: Real-Time Generative World Model for Closed-Loop Autonomous Vehicle Simulation},
  author        = {Basant, Aarti and Kar, Amlan and Paschalidou, Despoina and Wei, Fangyin and Ferroni, Francesco and Garcia Cobo, Guillermo and Turki, Haithem and Ling, Huan and Seo, Jaewoo and Lucas, James and Wu, Jay Zhangjie and Wang, Jialiang and Lorraine, Jonathan and Gao, Jun and He, Kai and Tothova, Katarina and Xie, Kevin and Tyszkiewicz, Micha{\l} and Wu, Qi and de Lutio, Riccardo and Li, Ruilong and Fidler, Sanja and Kim, Seung Wook and Shen, Tianchang and Cao, Tianshi and Pfaff, Tobias and Lew, William and Wu, Xindi and Ren, Xuanchi and Lu, Yifan and Zhang, Yuxuan and Gojcic, Zan and Wang, Zian},
  year          = {2026},
  eprint        = {2606.03159},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CV},
  doi           = {10.48550/arXiv.2606.03159},
  url           = {https://arxiv.org/abs/2606.03159},
}
```
