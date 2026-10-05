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
that repository. It is a self-contained uv workspace: its `eden` package is the
FlashDreams integration, which is a different package from the `eden/` at the
Eden repository root, and neither imports the other.

FlashDreams itself is a high-performance inference and serving library for
interactive autoregressive video and world models. For every other model, the
full documentation, and the developer guides, use upstream.

## System Requirements

- NVIDIA GPU with **80 GB VRAM or more** (e.g. H100 80GB), see notes below.
- NVIDIA driver from the **R580 series or newer** (default compatible with CUDA 13.x)
- **CUDA 13.x by default** (PyTorch `2.11.0+cu130` and the `nvidia-*-cu13` libraries are
  resolved by `uv sync`. A system CUDA toolkit is needed only for the
  developer extras and is included in `nvidia/cuda:13.2.1-cudnn-devel-ubuntu24.04`)
- **Python >= 3.10**
- **PyTorch >= 2.11.0+cu130** (`>= 2.9` for bare PyPI library install)
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

The complete setup is in
[the installation guide](https://nvidia.github.io/flashdreams/main/quickstart/index.html#install).
Assuming `uv` is [installed](https://docs.astral.sh/uv/getting-started/installation), the shortest viable path is:

```bash
cd realtime          # from the Eden repository root
uv sync --extra runners
export HF_TOKEN=<your-hf-token>
uv run flashdreams-run --help
```

Note for developers/maintainers you would want to run `uv sync --extra dev --extra runners` instead.

### Select CUDA Version

FlashDreams defaults to the CUDA 13 PyTorch stack (the `cuda13` dependency
group is activated automatically via `default-groups`):

- **Linux:** `uv sync` pulls `torch>=2.9` from PyPI, whose Linux wheels are
  the CUDA 13 build (the `+cu130` local-version tag is just stripped on
  PyPI).
- **Windows:** `uv sync` pulls torch from NVIDIA's `cu130` index
  (`https://download.pytorch.org/whl/cu130`) — PyPI's Windows torch wheel
  is CPU-only.

CUDA 12.8 is available as an opt-in side profile (Linux only) via the
`cuda12` dependency group:

```bash
uv sync --group cuda12 --extra runners
```

The two groups are declared mutually exclusive in `pyproject.toml`, so uv
deactivates the default `cuda13` group automatically when `--group cuda12`
is passed.

Then launch a game session with `start.sh` (see below), or drive `run.py`
directly:

```bash
uv run --project integrations_v2/eden \
    flashdreams-run-v2 game2v-eden-world-v2-5b-taehv -- --help
```

You can also install FlashDreams as a library from PyPI:

```bash
pip install flashdreams
```

### Launch the workbench

The page is a workbench: it opens on a home screen where you pick a game from
the gallery or describe a new one, and nothing renders until a game is chosen.
Four services, in this order -- the first three are independent of each other,
the app wants them up first.

```bash
# 1. TURN relay, on the GPU pod. A browser outside the pod's subnet has no
#    direct UDP path to it, and its connection stalls without the relay.
bash turn_server.sh

# 2. Workbench bridge, on the host that has the `claude` CLI (the DSW notebook).
#    It runs the game-generation jobs. Writes the shared token both sides use.
bash workbench_bridge.sh

# 3. FLUX worker, on the GPU pod. Renders the photoreal first frame.
bash workbench_flux.sh            # FLUX_GPU=<n> to place it

# 4. The model app, on the GPU pod. Starts the FLUX worker itself if step 3
#    was skipped.
NPROC=2 bash launch.sh            # one rank per GPU; default 2
```

Then open `http://<pod>:8089/`. `NPROC` sets how many ranks `torchrun` starts,
one per GPU -- set it to the number of GPUs you want to use. `GAME` picks which
cover the session falls back to; the slugs come from
[`games/registry.json`](games/registry.json) and default to `subway-run`.

Weights are expected in `HF_HOME` (default `/root/cache`), loaded with
`HF_HUB_OFFLINE=1`. `copy_models_cache.sh` stages them from a shared cache onto
local disk, which matters because the loader `mmap()`s each shard and `mmap` over
FUSE object storage is roughly two orders of magnitude slower.

Making a game takes tens of minutes (an agent writes and plays it), so the
left column keeps its job log across a page reload. Picking an existing game
takes a few seconds. `launch.sh` logs to `.eden_app.log`.

### How the four services fit together

```
browser ──8089──> model app (GPU pod, rank 0)
                    │  /ext/workbench/  proxied, token-authenticated
                    ├──8091──> bridge      (DSW notebook: runs `claude` jobs)
                    └──8092──> FLUX worker (GPU pod: first-frame render)
browser <──3478──── TURN relay (GPU pod: media path for off-subnet clients)
```

Rank zero owns the browser-facing side: the page, the Chromium proxy render,
and the `/ext/workbench/` proxy. The bridge lives on the notebook because that
is where the `claude` CLI is, and it is reached with a shared token written to
`.workbench/token` on its first run (`launch.sh` reads the same file).

The TURN relay is the one that fails quietly. Media needs a UDP path the page
load does not, so a client on another subnet has no route to the pod without
it. An address pointing at a relay that is not there is worse than none: the
browser stalls in "gathering candidates" for ten seconds and then fails,
instead of falling back. Both launchers default to the pod's own coturn, and
`turn_server.sh` is not supervised -- it needs starting again after a pod
restart.

### Without the workbench

`start.sh` is the older path: it renders from the first step with no home
screen and no generation, and needs neither the bridge nor the FLUX worker.

```bash
NPROC=8 bash start.sh eden-game2v-5b-taehv        # or eden-game2v-14b-taehv
```

A second argument of `off` disables transformer compilation, for when only
time-to-first-chunk matters. `EDEN_GAME` selects the game.

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

## Developer guides

- [Architecture](ARCHITECTURE.md)
- [Inference pipeline overview](https://nvidia.github.io/flashdreams/main/developer_guides/inference_pipeline_overview.html)
- [Config system](https://nvidia.github.io/flashdreams/main/developer_guides/config_system.html)

The docs site above is upstream's; it describes models this fork does not carry.

For day-to-day development:

```bash
uv sync --extra dev --extra runners
uv run --group lint pre-commit run -a
```

The test suites were removed along with the other integrations, so
`integrations_v2/eden/tests/` is the only `pytest` target here. It is
CPU-only:

```bash
pytest integrations_v2/eden/tests
```

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
