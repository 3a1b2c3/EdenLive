#!/usr/bin/env bash
# Run the shipped EdenLive example, picking an attention path the GPU supports.
#
# EdenLive's reference profile needs flash4, which the adapter accepts only on
# SM90 (Hopper): the check is an equality test against compute capability (9, 0),
# so no CUDA or torch version changes it. On anything else -- Blackwell included --
# two overrides are required:
#
#   model.teacher_forcing_attention_backend=triton   the only other backend
#   model.dynamic_prompt.enabled=false               this profile *requires* flash4,
#                                                    so it cannot be switched, only off
#
# Disabling dynamic_prompt drops the timestamped prompts in prompts.json; the
# static prompt still applies, and geometry and motion still come from the proxy
# video, so the clip renders without mid-sequence appearance changes.
#
# Usage:
#   ./run_example.sh                            5B bidirectional, 720p
#   ./run_example.sh CONFIG [extra overrides]   another config
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"
[ -x "$PY" ] || PY="$VENV/Scripts/python.exe"
[ -x "$PY" ] || { echo "ABORT: no venv. Run ./setup_and_run_example.sh --no-models first"; exit 1; }

CONFIG="${1:-$ROOT/edenlive/configs/wan22_5b_720p_bidir.yaml}"
[ $# -gt 0 ] && shift
[ -f "$CONFIG" ] || { echo "ABORT: no such config: $CONFIG"; exit 1; }

MODELS="$ROOT/models/EdenLive"
for need in dit-5b-bidir vae-5b umt5 vision-encoder; do
    [ -d "$MODELS/$need" ] || { echo "ABORT: missing $MODELS/$need -- run ./setup_and_run_example.sh"; exit 1; }
done

CAP="$("$PY" -c "import torch;print('%d.%d'%torch.cuda.get_device_capability(0) if torch.cuda.is_available() else 'none')" 2>/dev/null || echo none)"
NAME="$("$PY" -c "import torch;print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>/dev/null || true)"
echo "GPU: ${NAME:-unknown}  (compute capability ${CAP})"

OVERRIDES=()
if [ "$CAP" = "9.0" ]; then
    echo "    SM90: keeping the flash4 reference profile"
else
    echo "    not SM90: switching to triton and disabling dynamic_prompt"
    OVERRIDES+=(model.teacher_forcing_attention_backend=triton model.dynamic_prompt.enabled=false)
fi

cd "$ROOT"
set -x
"$PY" -m edenlive.scripts.infer --config "$CONFIG" "${OVERRIDES[@]}" "$@"
