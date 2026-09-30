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

需要 Python 3.10-3.12、CUDA，5B 在 720p 下需要一张 40GB 以上显存的 GPU。

```bash
git clone xxx
cd eden

# 先安装与驱动匹配的 CUDA 版 PyTorch。
pip install torch --index-url https://download.pytorch.org/whl/cu128

pip install -e ".[data]"
```

`[data]` 会带上 `decord`（视频解码）和 `pandas`/`pyarrow`（读 manifest），
manifest 驱动的推理路径需要它们。

可选：FlashAttention 4，提供最快的 teacher-forcing 注意力。它对版本敏感 ——
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
  inference.checkpoint=/path/to/ckpts/14b_480p/bidir
```

**Few-step** —— 分块自回归，每块 4 步，准实时：

```bash
torchrun --nproc_per_node=2 -m eden.scripts.infer \
  --config eden/configs/wan21_14b_480p_few_step.yaml \
  data.dataset.params.path=examples/samples/manifest.csv \
  data.dataset.params.root=examples/samples \
  runtime.sequence_parallel.size=2 \
  inference.checkpoint=/path/to/ckpts/14b_480p/few_step
```

**流式服务** —— 交互式实时推理：

```bash
# TODO
```

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

## 配置

`eden/configs/` 下每个配置都是一个自包含的 YAML 文件（无 include、无分组组合），
配合命令行 dotlist 覆盖。四个块：`model:` 指定 adapter 和权重目录，`runtime:` 指定并行与
缓存，`data:` 指定 manifest 和抽帧方式，`inference:` 指定采样本身：

```yaml
model:
  adapter: wan22_diffusers
  model_id: /path/to/Wan2.2-TI2V-5B-Diffusers
  torch_dtype: bfloat16

runtime:
  sequence_parallel: {enabled: true, size: 1, axis: temporal, layout: balanced_blocks}

data:
  dataset:
    name: manifest
    params:
      path: /path/to/proxy_manifest.csv
      root: /path/to/proxy_dataset

inference:
  strategy: chunk_causal      # 或 diffusion
  checkpoint: /path/to/ckpts/step_013000
  height: 704
  width: 1280
  num_frames: 117
  chunk_size: 3               # 仅 chunk_causal
  num_inference_steps: 30
  guidance_scale: 3.0
  seed: 42
```

值得了解的键：

| 键 | 含义 |
| --- | --- |
| `inference.strategy` | `diffusion`（双向）或 `chunk_causal`（自回归） |
| `inference.checkpoint` | 分片 DCP 目录，或单个 `.pt` 文件 |
| `inference.checkpoint_source` | `model`（默认）或 `ema`（载入保存的 EMA 权重） |
| `inference.use_prompt_loader` | 跳过数据集，直接用 `inference.prompt` 生成 |
| `inference.guidance_scale` | 文本 CFG 强度 |
| `inference.guidance_scale_proxy` | proxy 控制流的独立 CFG 强度 |
| `inference.chunk_size` | 每个自回归块的 latent 帧数 |
| `runtime.sequence_parallel.size` | 把一个样本的序列切到 N 张卡 |
| `runtime.kv_cache.context.max_latent_frames` | 长 rollout 的滑动 KV 窗口 |
| `model.teacher_forcing_attention_backend` | `triton` 或 `flash4` |

任何键都可以按位覆盖：
`inference.num_frames=241 runtime.kv_cache.context.max_latent_frames=21`。

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

## 许可

Apache 2.0 —— 见 [LICENSE](LICENSE)。模型权重与上游 Wan checkpoint 各自适用其自身许可。
