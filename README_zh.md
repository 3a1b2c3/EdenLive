<div align="center">

# Eden

**代理引导的视频世界模型：把粗糙的 3D 预览渲染成真实视频。**

[![Project Page](https://img.shields.io/badge/Project-Page-blue)](xxx)
[![Paper](https://img.shields.io/badge/arXiv-xxx-b31b1b)](xxx)
[![Model](https://img.shields.io/badge/%F0%9F%A4%97%20Hugging%20Face-Models-yellow)](xxx)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)

[项目主页](xxx) · [论文](xxx) · [模型](xxx) · [演示](xxx)

[English](README.md) · **简体中文**

由 [Vast AI](xxx) 出品

</div>

> **占位说明**：标记为 `xxx` 的链接，以及 `eden/configs/*.yaml` 里的
> `/path/to/...` 路径尚未发布。见[发布前清单](#发布前清单)。

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

| | 要求 |
| --- | --- |
| Python | 3.10 – 3.12（`>=3.10,<3.13`） |
| PyTorch | >= 2.6，CUDA 版本与驱动匹配 |
| GPU | 一张 NVIDIA 显卡；5B 在 720p 下需要 40GB 以上显存 |
| 操作系统 | Linux x86-64 |

PyTorch 必须先单独装：选哪个 wheel 取决于你驱动的 CUDA 版本，交给项目依赖去解析
会拉到不对的构建。

```bash
git clone xxx
cd eden

# 这里用 cu128，按自己的驱动换成对应的 CUDA 构建。
pip install torch --index-url https://download.pytorch.org/whl/cu128

pip install -e ".[data]"
```

`[data]` 会带上 `decord`（视频解码）和 `pandas`/`pyarrow`（读 manifest），
manifest 驱动的推理路径需要它们。不装的话只有 prompt 驱动那条路
（`inference.use_prompt_loader`）能用。

`realtime/` 下的实时流式服务是独立的 uv workspace，要求更高（CUDA 13.x、
PyTorch 2.11、80GB 显存）—— 见 [`realtime/README.md`](realtime/README.md)。

可选：FlashAttention 4，提供最快的注意力算子。它对版本敏感 ——
`flash_attn` 与 `cutlass` 不匹配时报
`AttributeError: module 'cutlass.cute.core' has no attribute 'ThrMma'`。
此时用 `model.teacher_forcing_attention_backend=triton` 回退。

```bash
pip install -r requirements/wan22-fa4.txt   # 见 docs/zh/wan22-fa4.md
```

## 模型权重

```bash
# TODO: 发布权重后替换。
huggingface-cli download xxx --local-dir ./checkpoints
```

### 快速开始

仓库在 `examples/samples/` 下自带两段 proxy 录制，以及指向它们的 manifest：

```
examples/samples/
  manifest.csv          id, prompt, proxy_video, first_frame
  boxed-in/             cover.png, first-frame.png, prompts.json, prompts.txt, recording.mp4
  dead-rush/            同样的五个文件
```

两段录制都是 1280x704，长度足以覆盖仓库内 81 帧的配置。下面的命令都用它们作为输入，把
`data.dataset.params.*` 换成自己的 manifest 即可跑自有数据。

`prompts.json` 保留完整的录制元信息 —— manifest 使用的 `staticPrompt`，以及片段内事件对应的
带时间戳 `dynamicPrompts`。`prompts.txt` 是同样内容的可读版本。

**双向** —— 全部帧联合去噪，质量最高：

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan21_14b_480p_bidir.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
```

**Few-step** —— 分块自回归，每块 4 步，准实时：

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan21_14b_480p_few_step.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
```

**流式服务** —— 交互式实时推理。proxy 不再来自录好的文件，而是浏览器里实时跑的游戏，
生成出来的帧通过 WebRTC 边生成边推给页面。这条路径在 [`realtime/`](realtime/) 下：

```bash
cd realtime
uv sync --package flashdreams-eden --extra runners

# 1. TURN 中继。媒体流需要 UDP 通路，而打开页面本身不需要，
#    所以跨网段的浏览器没有它就收不到视频。
bash turn_server.sh

# 2. FLUX worker。渲染每局开始时那张写实首帧。
bash workbench_flux.sh

# 3. 模型服务。权重要放在 HF_HOME 下，脚本会设 HF_HUB_OFFLINE=1。
NPROC=2 bash launch.sh          # 一张卡一个 rank
```

然后打开 `http://<host>:8089`。页面是一个工作台：先进首页，列出所有游戏，
**没选游戏之前不会开始渲染**。选中一个游戏就开始加载并推流；一局结束后可以
重开一局，或者回首页换一个。`NPROC` 决定 `torchrun` 起多少个 rank（一张卡一个），
按你想用的卡数填。

还有第四个服务 `workbench_bridge.sh`，只在要用一段文字描述**生成新游戏**时才需要，
它跑在装了 `claude` CLI 的机器上。只玩
[`realtime/games/registry.json`](realtime/games/registry.json) 里已有的游戏用不到它。

| 模型 | 应用 slug |
| --- | --- |
| 5B | `game2v-eden-world-v2-5b-taehv` |
| 14B | `game2v-eden-world-v2-14b-taehv` |

两者都用 TAEHV 解码器而不是 Wan VAE，牺牲一些画质换延迟。`realtime/` 是独立的 uv
workspace，有自己的 `eden` 包，和仓库根目录的 `eden/` 无关 —— 服务拓扑、不带工作台的
老启动脚本、以及开发指南见 [`realtime/README.md`](realtime/README.md)。

生成结果与所用条件一起写到 `<output_dir>/save/inference/<step>/`：生成的 `.mp4`、
proxy 控制视频、首帧、prompt —— 足以复核模型实际收到了什么。

## 使用自己的数据

推理读取 manifest（CSV/JSONL/JSON/parquet）。一行对应一次生成请求：

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

> **proxy 必须足够长以覆盖生成片段。** latent 帧数为 `(num_frames - 1) / 4 + 1`，
> 分块自回归每个 latent 帧消耗一个 proxy 帧。121 帧的 proxy 覆盖 31 个 latent 帧，
> 因此 `inference.num_frames=117`（30 latent）可行，而 `237`（60 latent）不行 ——
> 后者会以 *"Proxy-DINO source timeline is shorter than latent chunk"* 中止，
> 而不是静默地重复使用最后一帧 proxy。

## 配置检查

要确认随仓库发布的每个配置仍然能组合成一次可派发的运行 —— 能加载、指向已注册的
策略与适配器、请求的输出是适配器能产出的 —— 无需权重也无需 GPU：

```bash
python -m eden.scripts.check
```

这是静态检查。改动模型 forward、scheduler 或 cache 仍然需要一次真实推理验证。

## 发布前清单

- [ ] 替换所有 `xxx` 链接：项目主页、论文、模型仓库、演示、clone 地址。
- [ ] 发布权重并补全下载说明。
- [ ] 把 `eden/configs/` 里的 `/path/to/...` 占位符替换为发布后的权重、checkpoint
      与 manifest 位置。
- [ ] 在 `docs/assets/generated.mp4` 之外补充更多示例结果。
- [ ] 填写引用信息。

## 引用

```bibtex
@article{xxx,
  title   = {xxx},
  author  = {xxx},
  journal = {xxx},
  year    = {xxx}
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
