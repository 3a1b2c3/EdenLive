# Wan 2.2 teacher-forcing：FA4 与 precision-preserving compile

这是 Wan 2.2 的显式性能开关。默认配置继续使用 Triton FlexAttention 并关闭
block compile，因此已有 bidir、teacher-forcing 和 chunk-AR 配置保持原行为。

## 支持范围

- FA4 使用官方 `flash-attn-4` 包，通过 PyTorch FlexAttention 的
  `kernel_options.BACKEND=FLASH` 调用；不使用 Diffusers attention backend。
- 当前验证组合为 SM90、BF16、PyTorch 2.11、SP=1。
- teacher-forcing 要求 `pack_first_frame: true`。arithmetic mask 支持无限历史，
  也支持有限 `max_latent_frames` 与 `sink_latent_frames`（包括 stage1 使用的
  `max_latent_frames: 18`、`sink_latent_frames: 6`）。
- FA4 替换 teacher-forcing masked self-attention，也替换 SP=1、无 cache 的
  bidir unmasked self-attention。cached chunk-AR 和 text/image cross-attention
  继续使用原 dispatcher。
- bidir 的 direct FA4 调用使用官方 `flash_attn.cute.flash_attn_func`；因此
  `DIFFUSERS_ATTN_BACKEND` 应保持为 `native`，不能设置为 Diffusers 的
  `flash`（后者是 FA2 接口）。
- `runtime.torch_compile` 编译 adapter-owned transformer blocks。它独立于 FA4，
  因此可用于 bidir 和 teacher-forcing。

不支持的 GPU、dtype、SP 或 mask 布局会明确报错，不会静默回退。需要 SP>1 或
非 packed first-frame 布局时，设置 `model.teacher_forcing_attention_backend=triton`。

## 安装

已经验证的 CUDA 12.8 组合记录在
`requirements/wan22-fa4-cu128-constraints.txt`：

```bash
python -m pip install \
  torch==2.11.0+cu128 torchvision==0.26.0+cu128 torchaudio==2.11.0+cu128 \
  --index-url https://download.pytorch.org/whl/cu128
python -m pip install -r requirements/wan22-fa4.txt \
  -i https://mirrors.aliyun.com/pypi/simple/
python -c 'import torch, flash_attn.cute; print(torch.__version__, torch.version.cuda)'
```

`flash-attn-4` 才是 FA4。旧环境中已安装的 `flash-attn`（FA2）或
`flash-attn-3` 可能因为 Torch ABI 不匹配而破坏顶层 `flash_attn` import；专用训练
环境应卸载不匹配的旧包，再强制重装 `flash-attn-4`。

## 配置

在所用 config 的 `model:` / `runtime:` 块里设置以下键（每个 config 自包含，没有共享 preset 文件）：

```yaml
model:
  teacher_forcing_attention_backend: flash4
runtime:
  torch_compile:
    enabled: true
    backend: inductor
    mode: default
    fullgraph: false
    dynamic: false
    preserve_precision: true
```

`preserve_precision` 把 `emulate_precision_casts=True` 作为单次 Inductor 编译选项，
保留中间 downcast/upcast 的舍入且不修改全进程配置。该开关要求 Inductor 的
default mode；它不把 BF16 变成 FP32，也不保证与 eager 逐元素一致。

## GPU smoke test

仓库提供使用真实 DiT 权重和 synthetic pre-encoded inputs 的 F+B 工具：

```bash
python -m torch.distributed.run --standalone --nproc-per-node=1 \
  -m eden.scripts.benchmark_wan22_teacher_forcing \
  --model /path/to/Wan2.2-TI2V-5B-Diffusers \
  --variant fa4_compile --output /new/output/directory
```

它验证真实 FA4 forward/backward、activation checkpointing、FSDP2 wrapping、
compiled blocks、有限梯度与环境版本；不包含 encoder、真实数据或 optimizer，不能
替代完整 trainer mini-train。
