<!-- Modified by Vast AI for EdenLive. Copyright (c) 2026 Vast AI. -->

<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# FlashDreams — Eden game2v deployment

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
</p>

Real-time serving for [EdenLive](../README.md), based on
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams).
Installation: [repository README](../README.md#installation).
FlashDreams documentation: [upstream](https://github.com/NVIDIA/flashdreams).

## System Requirements

- NVIDIA GPU with **80 GB VRAM or more** (e.g. H100 80GB).
- NVIDIA driver from the **R580 series or newer** (default compatible with CUDA 13.x)
- **CUDA 13.x** (PyTorch `2.13.0+cu130`, the build [`requirements.txt`](requirements.txt)
  is pinned against; a CUDA 12.8 driver takes the `cu128` wheel index instead)
- **Python 3.10** (the verified environment)
- **PyTorch 2.13 or newer, cu130** (verified with the `2.14.0.dev20260717+cu130`
  nightly and torchvision 0.28.0), with a matching torchvision
- Linux x86-64 or arm64
- **100 GB+ free storage space** recommended for environment and model checkpoints.
- Docker with the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
  (optional, only for the container workflow)

## Quickstart

The launch scripts use `python` from the active environment.
Install dependencies:

```bash
cd realtime
pip install torch==2.13.0 torchvision==0.28.0 \
    --index-url https://download.pytorch.org/whl/cu130
pip install --no-deps -e ./flashdreams -e ./apps/cam2v \
    -e ./integrations_v2/eden
pip install -r requirements.txt
python -m playwright install chromium
```

For CUDA 12.8, use `https://download.pytorch.org/whl/cu128`.
Install game rendering dependencies:

```bash
npm install --prefix games
```

Configure the weight directory, service addresses, ports, and GPU count in
[`deploy.conf`](deploy.conf). `MODEL_ROOT` specifies the weight directory.

### Configure and start TURN

Set `TURN_HOST` (the relay address reachable by the browser), `TURN_IFACE`
(the relay interface), and `TURN_SECRET` (your own password) in
`deploy.conf`. On the GPU host, start TURN before either model launcher:

```bash
apt-get install coturn  # First-time installation
bash turn_server.sh
```

Neither `start.sh` nor `launch.sh` starts TURN automatically.

### Launch the workbench

The workbench provides a game library, game generation, and video playback.
The bridge host requires the `claude` CLI, `claude auth login`, and first-run trust confirmation.
Game generation uses `--dangerously-skip-permissions`.

```bash
# 1. TURN relay, GPU host; skip if already running
bash turn_server.sh

# 2. Workbench bridge, Claude CLI host
bash workbench_bridge.sh

# 3. FLUX first-frame service, GPU host
bash workbench_flux.sh

# 4. Model service, GPU host
bash launch.sh

# Stop services on this host
bash stop.sh
```

Open `http://<host>:8089` (`APP_PORT` in `deploy.conf`).
`NPROC` specifies the GPU count; the default 5B deployment uses one GPU.
`GAME` selects a game from
[`games/registry.json`](games/registry.json); the default is `freeze`.

For separate hosts, copy the bridge's `.workbench/token` to the GPU host's
`realtime/` directory and set `BRIDGE_HOST`; leave it empty for a single-host deployment.

Weights live in one directory, `MODEL_ROOT` in [`deploy.conf`](deploy.conf),
which defaults to `models/EdenLive` under the repository root. A relative path
there is read from the repository root. The realtime pipeline configs
([`integrations_v2/eden/configs/`](integrations_v2/eden/configs)) can pin the
tree themselves with their own `model_root`, which wins over `deploy.conf`.
Serving reads `dit-14b/`, `dit-5b/`, `vae-14b/`, `vae-5b/`, `decoder-14b/`,
`decoder-5b/`, `umt5/`, `clip/`, `vision-encoder/` and `flux-c2f/`; the
`*-bidir/` and `scheduler-*/` directories in the same tree are only used by the
offline configs. The full layout is in the
[repository README](../README.md#model-weights). Everything is loaded with
`HF_HUB_OFFLINE=1`.

`launch.sh` logs to `.eden_app.log`.

### How the four services fit together

```
browser ──8089──> model app (GPU server, rank 0)
                    │  /ext/workbench/  proxied, token-authenticated
                    ├──8091──> bridge      (host with the `claude` CLI)
                    └──8092──> FLUX worker (GPU server: first-frame render)
browser <──3478──── TURN relay (media path for off-subnet clients)
```

### Without the workbench

Run a registered game on the GPU host:

```bash
bash turn_server.sh  # Configure TURN first; skip if already running
bash start.sh 5b      # or 14b; defaults to MODEL in deploy.conf
```

`start.sh` reads `deploy.conf`. Pass `--no-compile` as the second argument to disable compilation.

## Supported models

| Application slug | Model |
| --- | --- |
| `game2v-eden-world-v2-5b-taehv` | Eden game2v 5B, TAEHV decoder |
| `game2v-eden-world-v2-14b-taehv` | Eden game2v 14B, TAEHV decoder |

Both models use the TAEHV (LightTAE) decoder.

## Contributing

FlashDreams contributions: [upstream repository](https://github.com/NVIDIA/flashdreams).

FlashDreams issues: [GitHub Issues](https://github.com/NVIDIA/flashdreams/issues).

Community: [NVIDIA Omniverse Discord](https://discord.com/invite/nvidiaomniverse),
channel [`#flashdreams`](https://discord.gg/cMt2mHm4aN).

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

FlashDreams references:

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
