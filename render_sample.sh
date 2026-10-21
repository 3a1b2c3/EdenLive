#!/usr/bin/env bash
# Render one recording from a sample folder with the 5B bidirectional EdenLive config (offline mode, about 70 s per 121 frames
# on a shared GPU). Checks that the recording, prompt and reference image exist and that the GPU has room, runs the inference,
# and prints the path of the finished video.
#
# Usage:   bash render_sample.sh [--samples DIR] [--cover IMAGE] [--frames N] [--out DIR]
#   --samples   folder holding manifest.csv and one subfolder per recording        [examples/city_racer]
#   --cover     reference image (the photoreal first frame); copied into the first manifest row's folder as cover.png
#   --frames    121 (5 s) or 241 (10 s); must be 1 + 4*n and fit the recording    [121]
#   --out       output folder under the repository                                [inference/<samples folder name>]
#   --condition-fps N  rate at which the proxy video is sampled for conditioning, 1..24; the model was trained with 6   [config default 6]
# Environment: MIN_FREE_MIB  free GPU memory required, in MiB                       [40000]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

samples="examples/city_racer"
cover=""
frames=121
out=""
condition_fps=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) samples="${2:?--samples needs a folder}"; shift 2 ;;
    --cover) cover="${2:?--cover needs an image path}"; shift 2 ;;
    --frames) frames="${2:?--frames needs a number}"; shift 2 ;;
    --out) out="${2:?--out needs a folder}"; shift 2 ;;
    --condition-fps) condition_fps="${2:?--condition-fps needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown option $1" >&2; exit 2 ;;
  esac
done

[[ -f "${samples}/manifest.csv" ]] || { echo "ERROR: ${samples}/manifest.csv not found" >&2; exit 2; }
if (( (frames - 1) % 4 != 0 )); then
  echo "ERROR: --frames must be 1 + 4*n (for example 121 or 241), got ${frames}" >&2
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

min_free="${MIN_FREE_MIB:-40000}"
free_mib="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1 | tr -d ' ')"
echo "GPU free: ${free_mib} MiB (needs at least ${min_free})"
if [[ "${free_mib}" -lt "${min_free}" ]]; then
  echo "ERROR: not enough free GPU memory; the GPU is shared. Not starting." >&2
  exit 1
fi

if [[ -z "${out}" ]]; then
  out="inference/$(basename "${samples}")"
fi
overrides=(data.dataset.params.path="${samples}/manifest.csv" data.dataset.params.root="${samples}" inference.output_dir="${out}")
if [[ "${frames}" != 121 ]]; then
  overrides+=(data.dataset.params.max_frames="${frames}" inference.num_frames="${frames}" inference.max_frames="${frames}")
fi
if [[ -n "${condition_fps}" ]]; then
  if ! [[ "${condition_fps}" =~ ^[0-9]+$ ]] || (( condition_fps < 1 || condition_fps > 24 )); then
    echo "ERROR: --condition-fps must be a whole number from 1 to 24, got ${condition_fps}" >&2
    exit 2
  fi
  overrides+=(inference.condition_video_fps.video_context="${condition_fps}")
  echo "proxy conditioning rate: ${condition_fps} fps (the model was trained with 6)"
fi

log="${out}.render.log"
mkdir -p "$(dirname "${out}")"
start="$(date +%s)"
.venv/bin/python -m edenlive.scripts.infer --config edenlive/configs/wan22_5b_720p_bidir.yaml "${overrides[@]}" 2>&1 | tee "${log}"
end="$(date +%s)"
elapsed=$(( end - start ))
echo "Done in ${elapsed} s for ${frames} frames = $(awk -v f="${frames}" -v s="${elapsed}" 'BEGIN {printf "%.2f", f / s}') fps (whole run, including model load). Output folder: $(pwd)/${out}/save/inference/base/"
# Model loading is excluded from the speed: generation starts at the last "components loaded" line of the log.
.venv/bin/python - "${log}" "${end}" "${frames}" <<'PY'
import datetime
import re
import sys

log, end, frames = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])
loaded = None
with open(log, encoding="utf-8", errors="replace") as stream:
    for line in stream:
        match = re.match(r"(\d\d)/(\d\d) (\d\d:\d\d:\d\d) \|.*components loaded", line)
        if match:
            loaded = match.groups()
if loaded is None:
    print('speed without model load: not found (no "components loaded" line in the log)')
    sys.exit(0)
year = datetime.date.today().year
start = datetime.datetime.strptime(f"{year}-{loaded[0]}-{loaded[1]} {loaded[2]}", "%Y-%m-%d %H:%M:%S").timestamp()
seconds = end - start
print(f"speed without model load: {frames} frames in {seconds:.0f} s = {frames / seconds:.2f} fps (log: {log})")
PY
ls -la "${out}/save/inference/base/"*.mp4
