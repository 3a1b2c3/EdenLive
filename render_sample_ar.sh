#!/usr/bin/env bash
# Render one recording from a sample folder with the 5B few-step autoregressive EdenLive config (offline run of the
# streaming model: 4 denoising steps, no classifier-free guidance, chunks of 3 latent frames). Checks that the recording,
# prompt, reference image and the dit-5b weights exist and that the GPU has room, runs the inference, and prints the
# path of the finished video. Sibling of render_sample.sh, which uses the 48-step bidirectional model.
#
# Usage:   bash render_sample_ar.sh [--samples DIR] [--cover IMAGE] [--frames N] [--out DIR] [--download]
#   --samples   folder holding manifest.csv and one subfolder per recording        [examples/city_racer]
#   --cover     reference image (the photoreal first frame); copied into the first manifest row's folder as cover.png
#   --frames    must be 12n-3: 117 (4.9 s), 237 (9.9 s), ...; must fit the recording  [117]
#   --out       output folder under the repository                                [inference/<samples folder name>_ar]
#   --download  fetch the dit-5b weights (about 20 GB) from Hugging Face when they are missing
# Environment: MIN_FREE_MIB    free GPU memory required, in MiB                     [40000]
#              TEXT_MODE       data.dataset.params.text_mode                        [global]
#              DYNAMIC         data.dataset.params.dynamic (true or false)          [false]
#              EXTRA_OVERRIDES extra key=value overrides, space separated, appended last
# The few-step config ships with text_mode=chunk and dynamic=true, which need per-chunk prompts and the flash4 backend
# that only SM90 GPUs allow; the defaults above use one prompt for the whole clip, like render_sample.sh does.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

samples="examples/city_racer"
cover=""
frames=117
out=""
download=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) samples="${2:?--samples needs a folder}"; shift 2 ;;
    --cover) cover="${2:?--cover needs an image path}"; shift 2 ;;
    --frames) frames="${2:?--frames needs a number}"; shift 2 ;;
    --out) out="${2:?--out needs a folder}"; shift 2 ;;
    --download) download=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown option $1" >&2; exit 2 ;;
  esac
done

[[ -f "${samples}/manifest.csv" ]] || { echo "ERROR: ${samples}/manifest.csv not found" >&2; exit 2; }
if (( (frames + 3) % 12 != 0 )); then
  echo "ERROR: --frames must be 12n-3 for 3-latent-frame chunks (117, 129, ..., 237), got ${frames}" >&2
  exit 2
fi

# The first manifest row decides which recording folder is rendered.
recording_dir="${samples}/$(.venv/bin/python -c 'import csv,sys; rows=list(csv.DictReader(open(sys.argv[1], newline="", encoding="utf-8"))); print(rows[0]["proxy_video"].rsplit("/", 1)[0])' "${samples}/manifest.csv")"
[[ -f "${recording_dir}/recording.mp4" ]] || { echo "ERROR: ${recording_dir}/recording.mp4 not found" >&2; exit 2; }
[[ -f "${recording_dir}/prompts.json" ]] || { echo "ERROR: ${recording_dir}/prompts.json not found" >&2; exit 2; }
if [[ -n "${cover}" ]]; then
  [[ -f "${cover}" ]] || { echo "ERROR: reference image not found: ${cover}" >&2; exit 2; }
  cp "${cover}" "${recording_dir}/cover.png"
  echo "reference image copied to ${recording_dir}/cover.png"
fi
[[ -f "${recording_dir}/cover.png" ]] || { echo "ERROR: ${recording_dir}/cover.png (the reference image) is missing; pass --cover" >&2; exit 2; }

# The recording must hold the requested frames (the proxy is sampled from it).
available="$(.venv/bin/python -c 'import av,sys; c=av.open(sys.argv[1]); print(c.streams.video[0].frames)' "${recording_dir}/recording.mp4")"
if (( available > 0 && frames > available )); then
  echo "ERROR: --frames ${frames} exceeds the ${available} frames in ${recording_dir}/recording.mp4" >&2
  exit 2
fi

weights="models/EdenLive/dit-5b/diffusion_pytorch_model.safetensors"
if [[ ! -f "${weights}" ]]; then
  if (( download )); then
    echo "dit-5b weights missing; downloading about 20 GB from Hugging Face (VAST-AI/EdenLive)"
    .venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('VAST-AI/EdenLive', allow_patterns=['dit-5b/*'], local_dir='models/EdenLive')"
    [[ -f "${weights}" ]] || { echo "ERROR: download finished but ${weights} is still missing" >&2; exit 1; }
  else
    echo "ERROR: ${weights} is missing. Re-run with --download to fetch it (about 20 GB)." >&2
    exit 1
  fi
fi

min_free="${MIN_FREE_MIB:-40000}"
free_mib="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1 | tr -d ' ')"
echo "GPU free: ${free_mib} MiB (needs at least ${min_free})"
if [[ "${free_mib}" -lt "${min_free}" ]]; then
  echo "ERROR: not enough free GPU memory; the GPU is shared. Not starting." >&2
  exit 1
fi

if [[ -z "${out}" ]]; then
  out="inference/$(basename "${samples}")_ar"
fi
overrides=(
  data.dataset.params.path="${samples}/manifest.csv"
  data.dataset.params.root="${samples}"
  data.dataset.params.max_frames="${frames}"
  data.dataset.params.text_mode="${TEXT_MODE:-global}"
  data.dataset.params.dynamic="${DYNAMIC:-false}"
  inference.num_frames="${frames}"
  inference.output_dir="${out}"
)
if [[ -n "${EXTRA_OVERRIDES:-}" ]]; then
  read -r -a extra <<< "${EXTRA_OVERRIDES}"
  overrides+=("${extra[@]}")
fi

start="$(date +%s)"
.venv/bin/python -m edenlive.scripts.infer --config edenlive/configs/wan22_5b_720p_few_step.yaml "${overrides[@]}"
elapsed=$(( $(date +%s) - start ))
echo "Done in ${elapsed} s for ${frames} frames. Output folder: $(pwd)/${out}"
find "${out}" -name '*.mp4' -printf '%TT  %s bytes  %p\n' | sort
