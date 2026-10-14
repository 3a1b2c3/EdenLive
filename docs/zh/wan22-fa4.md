# Wan 2.2：FA4 与 precision-preserving compile

5B 双向默认使用 FA4 self-attention 和分段文本 cross-attention，
并关闭 block compile。5B few-step 和两个 14B 配置继续使用缓存/SP 对应的注意力路径。

## 支持范围

- FA4 使用官方 `flash-attn-4` 包，通过 PyTorch FlexAttention 的
  `kernel_options.BACKEND=FLASH` 调用；不使用 Diffusers attention backend。
- 当前验证组合为 SM90、BF16、PyTorch 2.11、SP=1。
- FA4 替换 SP=1、无 cache 的 bidir unmasked self-attention。
  5B 动态文本 cross-attention 使用 FA4 varlen；cached chunk-AR 和 image
  cross-attention 继续走原 dispatcher。
- bidir 的 direct FA4 调用使用官方 `flash_attn.cute.flash_attn_func`，所以
  `DIFFUSERS_ATTN_BACKEND` 要保持 `native`，不能设成 Diffusers 的 `flash`
  （那是 FA2 接口）。
- `runtime.torch_compile` 编译 adapter 自己持有的 transformer block。它和 FA4
  相互独立，可以单独开。

不支持的 GPU、dtype、SP 或 mask 布局会明确报错，不会静默回退 —— 性能开关静默
失效比报错更难查。需要 SP>1 时设置
`model.teacher_forcing_attention_backend=triton` 回退（这个键名带
`teacher_forcing` 前缀是历史原因，它选的是通用注意力算子）。

## 安装

已有 `wm` 环境保留现有 PyTorch，安装所需的算子版本：

```bash
python -m pip install --no-deps flash-attn-4==4.0.0b31 \
  nvidia-cutlass-dsl==4.7.1 nvidia-cutlass-dsl-libs-core==4.7.1 \
  nvidia-cutlass-dsl-libs-base==4.7.1 \
  nvidia-cutlass-dsl-libs-cu12==4.7.1 cuda-python==12.9.7 \
  cuda-bindings==12.9.8 apache-tvm-ffi==0.1.14.post0 quack-kernels==0.6.5
```

升级 CUTLASS 时需清除旧的 `nvidia-cutlass-dsl-libs-core` / `libs-cu13` 4.6
组件，再安装完整的 core/base/cu12 4.7.1；这些包共享模块目录，混装会造成导入失败。
本次 `wm` 保留 PyTorch `2.14.0.dev20260717+cu130`，SM90 上的 FA4 varlen
BF16 内核已运行，微型测试与 SDPA 输出逐元素相同。

已经验证过的 CUDA 12.8 组合记录在
`requirements/wan22-fa4-cu128-constraints.txt`：

```bash
python -m pip install \
  torch==2.11.0+cu128 torchvision==0.26.0+cu128 torchaudio==2.11.0+cu128 \
  --index-url https://download.pytorch.org/whl/cu128
python -m pip install -r requirements/wan22-fa4.txt \
  -i https://mirrors.aliyun.com/pypi/simple/
python -c 'import torch, flash_attn.cute; print(torch.__version__, torch.version.cuda)'
```

`flash-attn-4` 才是 FA4。环境里已装的 `flash-attn`（FA2）或 `flash-attn-3`
可能因为 Torch ABI 不匹配而破坏顶层 `flash_attn` import；先卸载不匹配的旧包，
再强制重装 `flash-attn-4`。

## 配置

在所用 config 的 `model:` / `runtime:` 块里设置以下键（每个 config 自包含，
没有共享的 preset 文件）：

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

`preserve_precision` 把 `emulate_precision_casts=True` 作为单次 Inductor 编译
选项，保留中间 downcast/upcast 的舍入，且不修改全进程配置。它要求 Inductor 的
default mode；它不把 BF16 变成 FP32，也不保证和 eager 逐元素一致。

改完之后要跑一次真实推理，验证 FA4 和 compile 的数值行为。
