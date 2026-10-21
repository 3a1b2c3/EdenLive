#!/usr/bin/env bash
# EdenLive: create the venv, fetch the 5B weights, run the shipped example.
#
# Linux/WSL counterpart of setup_and_run_example.bat. Deviations from README.md:
#   - uv instead of conda; Python 3.11 rather than 3.10
#   - only the 5B bidirectional subset is fetched: 36.6 GB, not the full 210 GB.
#     The 14B DiTs (131 GB), flux-c2f, clip and the decoders are real-time or
#     14B-only and the offline example never reads them.
#   - the real-time service is skipped: no playwright, no npm, no TURN relay.
#
# Usage:
#   ./setup_and_run_example.sh              full: env, weights, example
#   ./setup_and_run_example.sh --no-models  environment only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
MODELS="$ROOT/models/EdenLive"
CONFIG="$ROOT/edenlive/configs/wan22_5b_720p_bidir.yaml"
CUDA_INDEX="https://download.pytorch.org/whl/cu130"

SKIP_MODELS=0
[ "${1:-}" = "--no-models" ] && SKIP_MODELS=1
NEED_GB=45
[ "$SKIP_MODELS" -eq 1 ] && NEED_GB=6

echo "=== checking free disk ==="
FREE_GB=$(df -BG --output=avail "$ROOT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -gt 0 ]; then
    echo "    ${FREE_GB} GB free, need ${NEED_GB} GB"
    if [ "$FREE_GB" -lt "$NEED_GB" ]; then
        echo
        echo "ABORT: the 5B subset needs 36.6 GB plus working room."
        echo "       dit-5b-bidir 20.0, umt5 11.4, vae-5b 2.8, vision-encoder 2.4"
        exit 1
    fi
else
    echo "    could not read free space, continuing"
fi

command -v uv >/dev/null || { echo "ABORT: uv not on PATH (https://astral.sh/uv)"; exit 1; }

echo
echo "=== 1/4 venv ==="
[ -d "$VENV" ] || uv venv --python 3.11 "$VENV"
PY="$VENV/bin/python"
[ -x "$PY" ] || PY="$VENV/Scripts/python.exe"   # Git Bash on Windows

echo
echo "=== 2/4 torch, CUDA 13 ==="
uv pip install --python "$PY" torch==2.13.0 torchvision==0.28.0 --index-url "$CUDA_INDEX"
"$PY" - <<'PYEOF'
import torch, sys
if not torch.cuda.is_available():
    sys.exit("ABORT: torch sees no CUDA device; delete .venv and rerun so uv "
             "does not resolve against a CPU wheel already present")
print("torch", torch.__version__, torch.cuda.get_device_name(0))
PYEOF

echo
echo "=== 3/4 edenlive and inference deps ==="
uv pip install --python "$PY" accelerate diffusers transformers ftfy huggingface-hub \
    imageio imageio-ffmpeg numpy pillow PyYAML safetensors pandas pyarrow av
# --no-deps on the package so the pinned torch above is not replaced
uv pip install --python "$PY" --no-deps -e "$ROOT"
# decord has no Windows wheel; on Linux it is the faster video reader
uv pip install --python "$PY" decord 2>/dev/null || echo "    decord unavailable, falling back to imageio"

if [ "$SKIP_MODELS" -eq 1 ]; then
    echo
    echo "=== weights and example skipped: --no-models ==="
    echo "    rerun without the flag once 45 GB is free"
    exit 0
fi

echo
echo "=== 4/4 weights, 5B subset only ==="
mkdir -p "$MODELS"
export MODELS
"$PY" - <<'PYDL'
from huggingface_hub import snapshot_download
import os
# The CLI module path moved between hub versions (huggingface_hub.commands is
# gone in recent releases, "hf download" is the new entry point), so call the
# library directly instead of depending on either.
snapshot_download(
    repo_id="VAST-AI/EdenLive",
    local_dir=os.environ["MODELS"],
    allow_patterns=["dit-5b-bidir/*", "vae-5b/*", "scheduler-5b/*",
                    "umt5/*", "vision-encoder/*"],
    max_workers=8,
)
print("weights complete")
PYDL


echo
echo "=== running the shipped example: 5B bidirectional, 720p ==="
cd "$ROOT"
"$PY" -m edenlive.scripts.infer --config "$CONFIG"
echo
echo DONE
