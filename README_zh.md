<div align="center">

# EdenLive

**EdenLive: Real-Time Generative Rendering from Any Reference**

[![Project Page](https://img.shields.io/badge/Project-Page-blue)](https://vast-eden.ai/?p=edenlive)
[![Model](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Models-yellow)](https://huggingface.co/VAST-AI/EdenLive)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

[项目主页](https://vast-eden.ai/?p=edenlive) · [代码](https://github.com/VAST-AI-Research/EdenLive) · [模型](https://huggingface.co/VAST-AI/EdenLive)

[English](README.md) · **简体中文**

Zehuan Huang<sup>1,\*</sup>, Tianxing Xu<sup>1,\*</sup>, Chunli Peng<sup>1,\*</sup>, Cheng Zhang<sup>1,\*</sup>, Yifei Song<sup>1,†</sup>, Zeyi Zheng<sup>1,†</sup>, Zhipeng Yu<sup>1</sup>, Peng Wang<sup>1,‡</sup>, Yanpei Cao<sup>1,✉</sup>

\* 同等贡献 · † VAST 实习生 · ‡ 项目负责人 · ✉ 通讯作者

<sup>1</sup>[VAST](https://www.tripo3d.ai/) · [Project Eden](https://vast-eden.ai/)

</div>

**TL;DR：**
* 面向交互式世界模型，我们把状态演化（由 coding agent 或引擎维护）和外观（由 EdenLive 渲染）解耦。
* EdenLive 实时把参考视频渲染成增强视频，帧率 24 FPS 或更高，即便在消费级显卡（RTX 5090）上也能做到。

https://github.com/user-attachments/assets/19978f5c-329d-4dce-a952-25c3b3187baf

## 简介

EdenLive 是一个实时生成式渲染器，把参考视频当作交互程序与神经视觉合成之间的接口：上游程序执行规则、维护世界状态，EdenLive 则在目标首帧和文本提示词的引导下，把由此得到的参考视频渲染成精细画面。

[官网](https://vast-eden.ai/?p=edenlive)展示了超过 24 FPS、分钟级连续生成及 480P/720P 输出。5B 模型支持 720P 单 GPU 部署。

我们已开源：

- [x] **5B 和 14B 模型权重**，覆盖双向和 few-step（分块自回归）两种推理。
- [x] **实时流式推理代码**。
- [x] **[`game-prototype-turbo`](realtime/skills/game-prototype-turbo/) skill**，把文本提示词变成可玩的粗粒度游戏。
- [x] **体验完整 prompt-to-game 管线的前端页面**。

## 安装

`edenlive/` 的离线推理和 `realtime/` 的实时服务共用一个 Python 环境。

| | 验证版本 |
| --- | --- |
| 系统 / GPU | Linux x86-64，80GB 显存的 NVIDIA 显卡（CUDA 13 驱动） |
| Python | 3.10 |
| PyTorch | `2.14.0.dev20260717+cu130` nightly（`realtime/requirements.txt` 锁的是 `2.13.0`，cu130），torchvision 0.28.0 |
| diffusers / transformers / accelerate | 0.39.0 / 5.12.1 / 1.0.1 |
| decord / pandas / pyarrow | 0.6.0 / 2.3.3 / 25.0.1 |
| imageio / imageio-ffmpeg | 2.37.4 / 0.6.0 |
| Node.js | 22（只用来拉游戏渲染用的 three.js） |

```bash
git clone https://github.com/VAST-AI-Research/EdenLive.git EdenLive
cd EdenLive

conda create -n edenlive python=3.10 -y
conda activate edenlive

# 1. PyTorch，对应 CUDA 13 驱动（CUDA 12.8 换成 .../whl/cu128）。
pip install torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu130

# 2. 实时服务及其锁定的依赖。
cd realtime
pip install --no-deps -e ./flashdreams -e ./apps/cam2v -e ./integrations_v2/eden
pip install -r requirements.txt
python -m playwright install chromium
npm install --prefix games
cd ..

# 3. 离线推理及视频读写依赖。
pip install av==17.1.0 decord==0.6.0 pandas==2.3.3 pyarrow==25.0.1 imageio==2.37.4 imageio-ffmpeg==0.6.0
pip install --no-deps -e .
```

5B 双向的默认配置采用 FA4 分段文本注意力，需要 SM90 GPU、BF16、
`flash-attn-4==4.0.0b31` 和 `nvidia-cutlass-dsl==4.7.1`。在已有环境里安装算子时
使用 `--no-deps` 保留 PyTorch；安装说明见 [`docs/zh/wan22-fa4.md`](docs/zh/wan22-fa4.md)。

## 模型权重

```bash
hf download VAST-AI/EdenLive --local-dir ./models/EdenLive
```

所有权重都从一个目录加载，默认是仓库根目录下的 `models/EdenLive`（合计约 210GB）。

```
models/EdenLive/
  dit-14b/            diffusion_pytorch_model.safetensors, config.json  14B few-step（分块自回归）DiT
  dit-14b-bidir/      diffusion_pytorch_model.safetensors, config.json  14B 双向 DiT
  dit-5b/             diffusion_pytorch_model.safetensors, config.json  5B few-step（分块自回归）DiT
  dit-5b-bidir/       diffusion_pytorch_model.safetensors, config.json  5B 双向 DiT
  vae-14b/            Wan2.1_VAE.pth, config.json
  vae-5b/             Wan2.2_VAE.pth, config.json
  decoder-14b/        lighttaew2_1.pth                    TAEHV 解码器（仅实时）
  decoder-5b/         lighttaew2_2.pth                    TAEHV 解码器（仅实时）
  scheduler-14b/      scheduler_config.json               仅离线
  scheduler-5b/       scheduler_config.json               仅离线
  umt5/               text_encoder/, tokenizer/           UMT5 文本编码器
  clip/               image_encoder/, image_processor/    CLIP，仅 14B I2V
  vision-encoder/     backbone/, projection.safetensors   proxy-DINO 编码器
  flux-c2f/           Diffusers FLUX 目录 + c2f_lora.safetensors   工作台首帧（仅实时）
```

默认权重目录为 `models/EdenLive`，相对于当前工作目录。指定其他目录：

```bash
python -m edenlive.scripts.infer --config ... model.pretrained_dir=/data/EdenLive
```

实时服务通过 [`realtime/deploy.conf`](realtime/deploy.conf) 里的 `MODEL_ROOT` 读同一个目录。

### 快速开始

仓库在 `examples/samples/` 下自带两段 proxy 录制，以及指向它们的 manifest：

```
examples/samples/
  manifest.csv        id, prompt, proxy_video, first_frame
  cryo-crossing/       cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  pulse-skirmish/      同样的五个文件
```

`recording.mp4` 为灰盒 proxy（1280x704），`first-frame.png` 为其首帧。
`cover.png` 为首帧的写实渲染，manifest 的 `first_frame` 指向该文件。
`prompts.json` 包含 `staticPrompt` 和带时间戳的 `dynamicPrompts`；
`prompts.txt` 为对应的文本版本。

| 模式 | Wan2.1-I2V-14B @ 480p | Wan2.2-TI2V-5B @ 720p |
| --- | --- | --- |
| 双向 | `wan21_14b_480p_bidir.yaml` | `wan22_5b_720p_bidir.yaml` |
| Few-step（分块自回归） | `wan21_14b_480p_few_step.yaml` | `wan22_5b_720p_few_step.yaml` |

**双向推理**：全部帧联合去噪。

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_bidir.yaml \
  runtime.sequence_parallel.size=2
```

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_bidir.yaml
```

**Few-step 推理**：分块自回归，每块 4 步。

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_few_step.yaml \
  runtime.sequence_parallel.size=2
```

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_few_step.yaml
```

**实时服务**：使用游戏画面作为输入，通过 WebRTC 输出视频。
权重目录、服务地址、端口和 GPU 数量在 [`realtime/deploy.conf`](realtime/deploy.conf) 中配置。
5B 默认使用单卡，多卡推理设置 `NPROC`。

先在 `realtime/deploy.conf` 中设置 `TURN_HOST`（浏览器可访问的中继地址）、
`TURN_IFACE`（中继网卡）和 `TURN_SECRET`（自设密码）。
运行已有游戏，在 GPU 机器上执行：

```bash
cd realtime
apt-get install coturn  # 首次安装
bash turn_server.sh    # 先启动 TURN
bash start.sh 14b       # 模型服务，或使用 5b
```

工作台（游戏库、用文字描述生成新游戏的对话、播放窗口）需要四个服务。它的首帧渲染（FLUX
worker）运行的是 FLUX.2 \[klein\] 9B，适用 FLUX 非商用许可，因此工作台**仅限非商业用途**，
且该许可要求对生成的图片做内容过滤（见[许可](#许可)）。用 `start.sh` 只玩已注册的游戏不会加载 FLUX。

bridge 运行机器需安装 `claude` CLI，完成 `claude auth login` 和首次信任确认。
游戏生成使用 `--dangerously-skip-permissions`。
跨机器部署时，将 bridge 的 `.workbench/token` 复制到 GPU 机器的 `realtime/` 目录，
并设置 `BRIDGE_HOST`；单机部署时留空。

```bash
cd realtime

# 1. TURN 中继，GPU 机器；已启动则跳过
bash turn_server.sh

# 2. 工作台 bridge，Claude CLI 所在机器
bash workbench_bridge.sh

# 3. FLUX 首帧服务，GPU 机器
bash workbench_flux.sh

# 4. 模型服务，GPU 机器
bash launch.sh

# 停止本机服务
bash stop.sh
```

打开 `http://<host>:8089`（`deploy.conf` 里的 `APP_PORT`）。

| 模型 | Application slug |
| --- | --- |
| 5B | `game2v-eden-world-v2-5b-taehv` |
| 14B | `game2v-eden-world-v2-14b-taehv` |

实时服务使用 TAEHV 解码器。服务拓扑和开发文档见
[`realtime/README.md`](realtime/README.md)。

## 使用自己的数据

默认配置读取录制 manifest（CSV/JSONL/JSON/parquet），一行对应一次请求。
每个目录包含 `recording.mp4`、`cover.png` 和 `prompts.json`；文本从
`prompts.json` 的 `staticPrompt` / `dynamicPrompts` 读取：

```csv
id,proxy_video,first_frame
shot_001,shot_001/recording.mp4,shot_001/cover.png
```

```bash
python -m edenlive.scripts.infer --config CONFIG.yaml \
  data.dataset.params.path=/data/my_manifest.csv \
  data.dataset.params.root=/data
```

## 使用 LightX2V 在 RTX 5090 上进行实时推理

[LightX2V](https://github.com/ModelTC/LightX2V) 为 EdenLive 的 14B 和 5B 模型提供加速推理，覆盖双向和四步自回归模式。支持低比特量化、高效算子与算子融合、KV缓存优化、`torch.compile` 与 CUDA Graph 加速，以及 LightTAE 流式解码。

**支持单张 RTX 5090 实时推理：** EdenLive 5B 在 **1280×704** 分辨率下实测推理吞吐约 **24.7 FPS**，满足 **24 FPS 实时播放**的帧率需求。

环境准备、模型转换、量化和启动命令见 [EdenLive 部署指南](https://github.com/ModelTC/LightX2V/blob/main/scripts/ed/README_zh.md)。

## 引用

```bibtex
@misc{edenlive2026,
  title  = {EdenLive: Real-Time Generative Rendering from Any Reference},
  author = {Zehuan Huang and Tianxing Xu and Chunli Peng and Cheng Zhang and Yifei Song and Zeyi Zheng and Zhipeng Yu and Peng Wang and Yanpei Cao},
  year   = {2026},
  url    = {https://vast-eden.ai/?p=edenlive}
}
```

## 致谢

基于 [Wan2.1 / Wan2.2](https://github.com/Wan-Video)、
🤗 [Diffusers](https://github.com/huggingface/diffusers)、
[DINOv3](https://github.com/facebookresearch/dinov3)、Black Forest Labs 的
[FLUX.2 \[klein\]](https://bfl.ai/models/flux-2-klein) 以及
[LightX2V](https://huggingface.co/lightx2v/Autoencoders) 的 LightTAE 解码器构建。
游戏渲染使用 [three.js](https://threejs.org)，工作台的游戏生成 skill 基于
[GameBlocks](https://github.com/xt4d/GameBlocks)。

`realtime/` 下的实时流式服务基于
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams)。

## 许可

本仓库自有代码采用 Apache 2.0 —— 见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。`realtime/` 同为
Apache 2.0，保留自己的 [LICENSE](realtime/LICENSE)、[NOTICE](realtime/NOTICE) 与
[THIRD-PARTY-NOTICES](realtime/THIRD-PARTY-NOTICES)。内置的 html-to-image 与
GameBlocks 衍生 skill 模块保留 MIT 许可及原作者版权声明；逐文件范围见
[REUSE.toml](realtime/REUSE.toml)。

模型权重单独发布，且**并非全部**是 Apache 2.0：

| 组件 | 许可 |
| --- | --- |
| `dit-*`、`vae-*`、`umt5/`、`scheduler-*`、`decoder-*` | Apache 2.0 |
| `clip/`（LAION CLIP ViT-H/14 / OpenCLIP） | [MIT](https://huggingface.co/laion/CLIP-ViT-H-14-laion2B-s32B-b79K) |
| `vision-encoder/`（DINOv3 及其衍生物） | [DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) |
| `flux-c2f/`（FLUX.2 \[klein\] 9B 加我们的 LoRA，仅用于工作台首帧） | [FLUX 非商用许可](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/blob/main/LICENSE.md) —— 仅限非商业、非生产用途 |

每个组件的许可证和声明文件随权重一起分发，详见模型仓库的 README。
