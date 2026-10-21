#!/usr/bin/env bash
# Install everything the real-time model service (start.sh) needs without root: the TAEHV decoder weights, a separate Python environment
# (.venv-rt in the repository root, so the offline renders' .venv is never changed), Node.js under ~/.local/node, the games' npm packages and
# a headless Chromium for Playwright. Does not install coturn (needs root) or the workbench's FLUX and Claude CLI services.
# Resumable: finished steps are skipped. Needs uv (~/.local/bin/uv), network access and about 12 GB of disk.
#
# Usage:   bash realtime/setup_user_space.sh
# Result:  PATH for the service:  . realtime/.rt_env.sh    (sets the venv and Node)
set -euo pipefail

self="$(readlink -f "${BASH_SOURCE[0]}")"
realtime="$(dirname "${self}")"
root="$(dirname "${realtime}")"
cd "${root}"

uv="${UV:-$HOME/.local/bin/uv}"
[[ -x "${uv}" ]] || { echo "ERROR: uv not found at ${uv}" >&2; exit 1; }
node_version="${NODE_VERSION:-22.11.0}"
node_dir="${HOME}/.local/node"

echo "== 1/6 decoder weights (models/EdenLive/decoder-5b)"
if [[ -f models/EdenLive/decoder-5b/lighttaew2_2.pth ]]; then
  echo "present"
else
  .venv/bin/python -c "from huggingface_hub import hf_hub_download; hf_hub_download('VAST-AI/EdenLive', 'decoder-5b/lighttaew2_2.pth', local_dir='models/EdenLive')"
fi
ls -l models/EdenLive/decoder-5b/lighttaew2_2.pth | awk '{print $5, $9}'

echo "== 2/6 separate Python environment (.venv-rt)"
[[ -d .venv-rt ]] || "${uv}" venv --python 3.11 .venv-rt
py=".venv-rt/bin/python"

echo "== 3/6 torch 2.13.0 cu130 and the real-time packages"
if ! "${py}" -c "import torch; assert torch.__version__.startswith('2.13.0'), torch.__version__" 2>/dev/null; then
  "${uv}" pip install --python "${py}" torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu130
fi
(cd realtime && "${uv}" pip install --python "../${py}" --no-deps -e ./flashdreams -e ./apps/cam2v -e ./integrations_v2/eden)
(cd realtime && "${uv}" pip install --python "../${py}" -r requirements.txt)
"${py}" -c "import torch, flashdreams; print('torch', torch.__version__, '| cuda available:', torch.cuda.is_available(), '| flashdreams ok')"

echo "== 4/6 Node.js ${node_version} -> ${node_dir}"
if [[ ! -x "${node_dir}/bin/node" ]]; then
  mkdir -p "${node_dir}"
  curl -fsSL "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-arm64.tar.xz" | tar -xJ -C "${node_dir}" --strip-components=1
fi
"${node_dir}/bin/node" --version

echo "== 5/6 npm packages for the games"
PATH="${node_dir}/bin:${PATH}" npm install --prefix realtime/games

echo "== 6/6 headless Chromium for Playwright"
"${py}" -m playwright install chromium

cat > realtime/.rt_env.sh <<EOF
# Source this before start.sh: use the real-time environment and Node.
export PATH="${root}/.venv-rt/bin:${node_dir}/bin:\${PATH}"
EOF
echo "done. Next: . realtime/.rt_env.sh && cd realtime && bash start.sh 5b"
