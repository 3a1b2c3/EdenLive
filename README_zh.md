<div align="center">

# Eden

**EdenLive: Real-Time Generative Rendering from Any Reference**

[![Project Page](https://img.shields.io/badge/Project-Page-blue)](xxx)
[![Paper](https://img.shields.io/badge/arXiv-xxx-b31b1b)](xxx)
[![Model](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Models-yellow)](xxx)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

[项目主页](xxx) · [论文](xxx) · [模型](xxx) · [演示](xxx)

[English](README.md) · **简体中文**

由 [Vast AI](xxx) 出品

</div>

> **占位说明**：标记为 `xxx` 的链接和权重下载命令尚未发布。见[发布前清单](#发布前清单)。

<div align="center">
  <video src="docs/assets/generated.mp4" width="100%" controls loop muted autoplay playsinline></video>
</div>

## 简介

Eden 从三个输入生成视频：**文本 prompt**、**首帧**，以及一段 **proxy 控制视频**，模型保留 proxy 的布局、相机运动和时序，
同时把外观替换为真实细节。这让输出是**可导演的**：你在游戏引擎或预演工具里编排运动，
交给模型渲染。

控制信号通过 **vision encoder** 注入：一个后训练的 DINOv3 编码器逐帧提取 proxy 特征，
再用这些特征条件化扩散 Transformer。


## 安装

`edenlive/` 的离线推理和 `realtime/` 的实时服务共用一个 Python 环境。下表是本次发布
实际验证所用环境里的版本：

| | 验证版本 |
| --- | --- |
| 系统 / GPU | Linux x86-64，80GB 显存的 NVIDIA 显卡（CUDA 13 驱动） |
| Python | 3.10 |
| PyTorch | `2.14.0.dev20260717+cu130` nightly（`realtime/requirements.txt` 锁的是 `2.13.0`，cu130），torchvision 0.28.0 |
| diffusers / transformers / accelerate | 0.39.0 / 5.12.1 / 1.0.1 |
| decord / pandas / pyarrow | 0.6.0 / 2.3.3 / 25.0.1 |
| imageio / imageio-ffmpeg | 2.37.4 / 0.6.0 |
| Node.js | 22（只用来拉游戏渲染用的 three.js） |

按下面的顺序装。PyTorch 必须最先装、并从 CUDA 的 index 装；仓库内的包一律加
`--no-deps`，否则 pip 会按它们声明的依赖把 CUDA 版 torch 换成 PyPI 上的版本。

```bash
git clone xxx EdenLive
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

# 3. 离线推理：manifest 读取和视频读写，然后装本包。
pip install av==17.1.0 decord==0.6.0 pandas==2.3.3 pyarrow==25.0.1 imageio==2.37.4 imageio-ffmpeg==0.6.0
pip install --no-deps -e .
```

根目录的包以 `edenlive` 导入。`realtime/` 另装一个以 `eden` 导入的包（FlashDreams 的
集成），两者互不导入。

5B 双向的默认配置采用 FA4 分段文本注意力，需要 SM90 GPU、BF16、
`flash-attn-4==4.0.0b31` 和 `nvidia-cutlass-dsl==4.7.1`。在已有环境里安装算子时
使用 `--no-deps` 保留 PyTorch；安装说明见 [`docs/zh/wan22-fa4.md`](docs/zh/wan22-fa4.md)。

## 模型权重

```bash
# TODO: 发布权重后替换。
huggingface-cli download xxx --local-dir ./models/EdenLive
```

所有权重都从一个目录加载，默认是仓库根目录下的 `models/EdenLive`（合计约 210GB），
运行时不会从 Hub 拉任何东西。

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

离线配置写的是 `model.pretrained_dir: models/EdenLive`，这是相对当前工作目录的路径，
各组件再按 `model.components.*.path` 相对它解析。在仓库根目录运行即可，或者指到别处：

```bash
python -m edenlive.scripts.infer --config ... model.pretrained_dir=/data/EdenLive
```

想用同一套 VAE、T5、CLIP 跑另一个 DiT，只覆盖这一个组件：

```yaml
model:
  components:
    transformer:
      path: /path/to/our-dit     # 绝对路径，或相对 pretrained_dir
```

`model.pipeline_class` 指定组装哪个 pipeline —— 14B I2V 用 `WanImageToVideoPipeline`，
5B TI2V 用 `WanPipeline`。

实时服务通过 [`realtime/deploy.conf`](realtime/deploy.conf) 里的 `MODEL_ROOT` 读同一个目录。

### 快速开始

仓库在 `examples/samples/` 下自带两段 proxy 录制，以及指向它们的 manifest：

```
examples/samples/
  manifest.csv        id, prompt, proxy_video, first_frame
  cryo-crossing/       cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  pulse-skirmish/      同样的五个文件
```

`recording.mp4` 是灰盒 proxy（1280x704），`first-frame.png` 是它的第一帧；`cover.png`
是这一帧的写实渲染，manifest 把它作为 `first_frame` 喂给模型。`prompts.json` 保留完整的
录制元信息 —— manifest 使用的 `staticPrompt`，以及带时间戳的 `dynamicPrompts`；
`prompts.txt` 是同样内容的可读版本。

两个测例来自 `eden-live-demo` 的以下录制：

| 测例 | 场景 | 原录制 ID |
| --- | --- | --- |
| `cryo-crossing` — 冰桥渡熔岩（Cryo Crossing） | 用冰冻枪在熔岩湖上冻结踏脚石，逐步穿越。 | `dcb95336e0284002af4408b6d95b4253` |
| `pulse-skirmish` — 脉冲巷战（Pulse Skirmish） | 在阳光下的街巷中双持脉冲枪，与战斗机器人交火。 | `d3c694b7f5f4427c8f64ad4cfc1a27ba` |

两段录制均为 24 FPS、717 帧（29.875 秒）。原始 proxy 视频、参考图片和 prompt JSON
均原样复制，推理输入全部随本仓库提供，运行时不依赖 `eden-live-demo`。
Few-step 默认处理两段完整录制；双向推理按下文的帧数上限截取。

两个模型，各两种推理模式。`edenlive/configs/` 下每个配置都是自包含的 —— 一个文件，
没有 include：

| 模式 | Wan2.1-I2V-14B @ 480p | Wan2.2-TI2V-5B @ 720p |
| --- | --- | --- |
| 双向 | `wan21_14b_480p_bidir.yaml` | `wan22_5b_720p_bidir.yaml` |
| Few-step（分块自回归） | `wan21_14b_480p_few_step.yaml` | `wan22_5b_720p_few_step.yaml` |

每个配置都已经指向 `examples/samples/manifest.csv`，下面的命令在仓库根目录直接能跑。

**双向** —— 全部帧联合去噪，质量最高：

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_bidir.yaml \
  runtime.sequence_parallel.size=2
```

**Few-step** —— 分块自回归，每块 4 步，接近实时：

```bash
torchrun --nproc_per_node=2 -m edenlive.scripts.infer \
  --config edenlive/configs/wan21_14b_480p_few_step.yaml \
  runtime.sequence_parallel.size=2
```

5B 配置生成 1280x704，使用单 GPU。双向从视频开头按时间戳取最多 121 帧；
few-step 按整段录制长度生成。14B 双向最多 81 帧，few-step 也按整段长度生成。
两种 few-step 均采用总窗口 18、sink 6、chunk 3 的固定窗口 RoPE。

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_bidir.yaml
```

```bash
python -m edenlive.scripts.infer \
  --config edenlive/configs/wan22_5b_720p_few_step.yaml
```

生成的视频以及生成时用到的条件写到 `<inference.output_dir>/save/inference/base/`
（默认 `inference/<配置名>/`）：生成的 `.mp4`、proxy 控制视频、首帧和 prompt。
文件名使用 manifest 的 `id`（例如 `cryo-crossing.mp4`）；每个序列并行组只由第一个 rank 保存产物。
默认 `recording_manifest` 从录制目录的 `prompts.json` 读取静态文本及动态事件，
按录制时间戳和指定空间变换准备输入，同时保存实际输入索引、请求及配置。

**流式服务** —— 交互式实时推理。proxy 来自浏览器里运行的游戏而不是录好的文件，帧一生成
就通过 WebRTC 推出去。这部分在 [`realtime/`](realtime/) 下；权重位置、地址、端口、卡数都写在
[`realtime/deploy.conf`](realtime/deploy.conf) 里，脚本从它读取。

只玩 [`realtime/games/registry.json`](realtime/games/registry.json) 里已有的游戏，在 GPU 机器上
一条命令就够了，不需要工作台 bridge 和 FLUX worker：

```bash
cd realtime
bash start.sh 14b      # 或 5b；从第一步起就渲染 deploy.conf 里的 GAME
```

实时游戏库包含七款游戏：冰桥渡熔岩（`freeze`，默认）、蛛穴探险（`spiders`）、
脉冲巷战（`tracer`）、深海电击（`bioshock`）、巨兽破城（`godzilla`）、
街机对决（`arcadeduel`）和沙漠交火（`dust2`）。每款都自带参考首帧及匹配的初始状态。


工作台（游戏库、用文字描述生成新游戏的对话、播放窗口）需要四个服务：

```bash
cd realtime

# 1. TURN 中继，在 GPU 机器上。媒体流需要 UDP 通路而打开页面不需要，所以跨网段的
#    浏览器没有它收不到视频。先在 deploy.conf 里设好 TURN_SECRET，再把这条命令打印
#    的地址填回 TURN_HOST。TURN_HOST 留空就不走中继（仅限浏览器与服务同网段）。
bash turn_server.sh

# 2. 工作台 bridge，在装了 `claude` CLI 的机器上（已 `claude auth login` 登录、过了首次
#    信任确认；它以 --dangerously-skip-permissions 无人值守运行）。它把共享 token 写到
#    .workbench/token；GPU 机器是另一台时把这个文件拷过去，并在那边设 BRIDGE_HOST。
#    单机部署时 BRIDGE_HOST 留空即可。
bash workbench_bridge.sh

# 3. FLUX worker，在 GPU 机器上，渲染写实首帧。
bash workbench_flux.sh

# 4. 模型服务，在 GPU 机器上。第 3 步没跑时会自己拉起 FLUX worker；
#    没有 .workbench/token 会拒绝启动。
bash launch.sh

# 停掉本机启动的服务。
bash stop.sh
```

打开 `http://<host>:8089`（`deploy.conf` 里的 `APP_PORT`）。页面分三块，按下开始前不渲染：

- **游戏库** —— 每个已注册游戏一张卡片，点开就在播放窗口里玩；工作台做出来的游戏也能从这里重新打开。
- **工作台** —— 左边对话、右边结果。第一条消息描述并生成游戏，之后的消息在同一个游戏上修改。
  右边可以在浏览器里试玩 proxy 游戏，也可以给它写 caption、渲染写实首帧。**New game** 开一个新对话。
- **播放窗口** —— 盖在页面上的浮层，播放模型生成的视频。关掉就停止渲染；一局结束后可以重玩或关闭。

`NPROC` 是 `torchrun` 起的 rank 数，一张卡一个。

| 模型 | Application slug |
| --- | --- |
| 5B | `game2v-eden-world-v2-5b-taehv` |
| 14B | `game2v-eden-world-v2-14b-taehv` |

两者都用 TAEHV 解码器而不是 Wan VAE，牺牲一些画质换延迟。服务拓扑和开发文档见
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

实际生成长度由录制时间戳和配置 FPS 决定，并向下取整到 `1 mod 4` 帧。
需要截短时覆盖 `data.dataset.params.max_frames`；双向配置保留各自的帧数上限。
原来的 `manifest` 数据集仍可用于独立配置中的通用 prompt / 视频输入。

## 发布前清单

- [ ] 替换所有 `xxx` 链接：项目主页、论文、模型仓库、演示、clone 地址。
- [ ] 发布 `models/EdenLive` 目录并补全下载命令。
- [ ] 在 `docs/assets/generated.mp4` 之外补充更多示例结果。
- [ ] 补全引用的作者、发表 venue 和链接。

## 引用

```bibtex
@article{edenlive2026,
  title   = {EdenLive: Real-Time Generative Rendering from Any Reference},
  author  = {xxx},
  journal = {xxx},
  year    = {2026}
}
```

## 致谢

基于 [Wan2.1 / Wan2.2](https://github.com/Wan-Video)、
🤗 [Diffusers](https://github.com/huggingface/diffusers) 和
[DINOv3](https://github.com/facebookresearch/dinov3) 构建。

`realtime/` 下的实时流式服务基于
[NVIDIA FlashDreams](https://github.com/NVIDIA/flashdreams)。

## 许可

Apache 2.0 —— 见 [LICENSE](LICENSE)。模型权重与上游 Wan checkpoint 各自适用其自身许可。
`realtime/` 同为 Apache 2.0，保留自己的 [LICENSE](realtime/LICENSE) 与
[NOTICE](realtime/NOTICE)。
