#!/usr/bin/env bash
# Copy every non-gated streaming-model weight from the shared HF cache on OSS
# (/mnt/share -> fuse.ossfs2) onto a local filesystem, preserving the HF cache
# layout so the destination can be used directly as HF_HOME.
#
# Only the repos the streaming runners actually load are copied (same set as
# download_streaming_models.sh), plus the lingbot-world-v2 set, the two external
# world-model projects (DreamX-World, ABot-World) whose weights live in the same
# shared cache, and the game2v-eden-world-v2-14b set (the Wan2.1 I2V CLIP image
# encoder and the DINOv3 ViT-L/16 backbone). The game2v-eden-world-v2-5b model
# adds nothing to this list: its VAE is Wan2.2-TI2V-5B's own Wan2.2_VAE.pth and
# its UMT5 comes from the Wan2.1 1.3B repo, both already listed below.
# HY-World (gated tencent/HY-WorldPlay) is not in that set and is never copied
# here even if present. The finetuned proxy-DINO checkpoint is not an HF repo;
# it is copied separately, below the repo loop, as are the two training DCP
# checkpoints (14B AR teacher-forced, 5B rollout-DMD).
#
# Why: the loader mmap()s each safetensors shard, and mmap over FUSE object
# storage reads at ~20 MiB/s. Reading the same files from a local disk is
# orders of magnitude faster.
#
# Usage:
#   bash copy_streaming_models_cache.sh            # target: /root/cache
#   bash copy_streaming_models_cache.sh /tmp/cache # custom target
#
# Re-running resumes where it left off (--partial --append-verify).
set -uo pipefail

SRC_HF="${SRC_HF:-/mnt/share/cache/huggingface}"
DST_HF="${1:-/root/cache}"

# Grouped exactly like download_streaming_models.sh's targets.
REPOS=(
  # shared encoder/decoder backbones
  "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
  "lightx2v/Autoencoders"
  # lingbot14b
  "robbyant/lingbot-world-fast"
  # lingbot-world-v2 set, mirroring download_lingbot_v2_weights.sh.
  # The 1.3b repo is DiT-only upstream; its T5/VAE/tokenizer are shared with
  # the 14B release, so keep the 14b-causal-fast donor listed here too.
  "robbyant/lingbot-world-v2-1.3b-causal-fast"
  "robbyant/lingbot-world-v2-14b-causal-pretrain"
  "robbyant/lingbot-world-v2-14b-bid"
  "robbyant/lingbot-world-v2-14b-causal-fast"
  # selfforcing13b
  "gdhe17/Self-Forcing"
  # causalforcing13b
  "zhuhz22/Causal-Forcing"
  # sanawm16b
  "Efficient-Large-Model/SANA-WM_streaming"
  "Efficient-Large-Model/gemma-2-2b-it"
  # waypoint1b
  "Overworld/Waypoint-1.5-1B"
  "Overworld-Models/taehv1_5"
  # fastvideo14b
  "FastVideo/CausalWan2.2-I2V-A14B-Preview-Diffusers"
  # dreamx-world (external project; mirrors download_dreamx_world_weights.sh).
  # These three are consumed as plain dirs, not HF_HOME — see the note below.
  # Wan2.2-TI2V-5B also carries the Wan2.2_VAE.pth that game2v-eden-world-v2-5b
  # encodes and decodes with, so that model needs no repo of its own.
  "Wan-AI/Wan2.2-TI2V-5B"
  "GD-ML/DreamX-World-5B-Cam"
  "GD-ML/DreamX-World-5B"
  # abot-world (external project; mirrors download_abot_world_weights.sh).
  # Single self-contained repo: VAE + tae + T5 encoder + safetensors + tokenizer.
  "acvlab/ABot-World-0-5B-LF"
  # game2v-eden-world-v2-14b (AR proxy-DINO I2V). The DiT comes from the DCP
  # checkpoint and the VAE from lightx2v/Autoencoders' Wan2.1_VAE.pth, both
  # handled above, so only the CLIP image encoder is needed from this snapshot
  # (see download_wan21_i2v_14b_480p.sh).
  "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"
  # DINOv3 ViT-L/16 backbone the proxy-DINO encoder is instantiated from.
  # Assembled by hand into the shared cache (ossfs rejects the blobs/symlink
  # layout, so the snapshot holds the files directly); from_pretrained still
  # resolves it, and rsync reproduces that layout at the destination.
  "facebook/dinov3-vitl16-pretrain-lvd1689m"
)

# -r recursive, -l keep symlinks (HF blobs layout), -p -t keep perms/mtimes.
# --info=progress2 gives one live aggregate progress line (%, rate, ETA) per repo.
# --partial --append-verify make an interrupted copy resumable.
RSYNC_ARGS=(
  -rlpt --info=progress2 -h --partial --append-verify
)

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required but not found." >&2
  exit 1
fi
if [ ! -d "$SRC_HF/hub" ]; then
  echo "Source HF cache not found: $SRC_HF/hub" >&2
  exit 1
fi

mkdir -p "$DST_HF/hub"

echo "Source : $SRC_HF/hub"
echo "Target : $DST_HF/hub"
free_kib=$(df -Pk "$DST_HF" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$free_kib" ]; then
  free_gib=$((free_kib / 1024 / 1024))
  echo "Free on target filesystem: ${free_gib} GiB"
  if [ "$free_gib" -lt 320 ]; then
    echo "WARNING: the full set is well over 600 GiB (three lingbot-world-v2 14B"
    echo "         variants at ~70 GiB each, plus DreamX-World ~74 GiB,"
    echo "         ABot-World ~23 GiB, the 14B AR DCP checkpoint at ~184 GiB and"
    echo "         the 5B rollout-DMD DCP checkpoint at ~132 GiB)."
    echo "         If this is /root (the 98G container disk), use /tmp/cache"
    echo "         instead, which has ~207 GiB free."
    echo "         Set SKIP_DIT=1 / SKIP_DIT_5B=1 to leave either DCP behind."
  fi
fi

ok=0
fail=0
skipped=0
for repo in "${REPOS[@]}"; do
  dir="models--${repo//\//--}"
  src_dir="$SRC_HF/hub/$dir"
  if [ ! -d "$src_dir" ]; then
    echo
    echo "[SKIP] $repo  (not present in source cache)"
    skipped=$((skipped + 1))
    continue
  fi
  echo
  echo "=== $repo -> $DST_HF/hub/$dir ==="
  if rsync "${RSYNC_ARGS[@]}" "$src_dir/" "$DST_HF/hub/$dir/"; then
    ok=$((ok + 1))
  else
    echo "  !! FAILED: $repo"
    fail=$((fail + 1))
  fi
done

echo
echo "Copied $ok repo(s), failed $fail, skipped $skipped."

# Finetuned proxy-DINO checkpoint. Plain files, not an HF repo, so they live
# beside the hub dir rather than inside it. Only best.pt is loaded; the other
# checkpoints in that directory (final.pt, step-*.pt) are not copied.
DINO_SRC="${DINO_SRC:-/mnt/pub_share/wangpeng/models/vision-encoders/dinov3l16-screened-completed-v2-p2-d1024-lr5e5/best.pt}"
DINO_DST="$DST_HF/vision-encoders/dinov3l16-screened-completed-v2-p2-d1024-lr5e5"
echo
if [ -f "$DINO_SRC" ]; then
  echo "=== proxy-DINO best.pt -> $DINO_DST ==="
  mkdir -p "$DINO_DST"
  if rsync "${RSYNC_ARGS[@]}" "$DINO_SRC" "$DINO_DST/best.pt"; then
    ok=$((ok + 1))
  else
    echo "  !! FAILED: $DINO_SRC"
    fail=$((fail + 1))
  fi
else
  echo "[SKIP] proxy-DINO best.pt  (not found at $DINO_SRC)"
  skipped=$((skipped + 1))
fi

# 14B AR DiT checkpoint (DCP). The model weights and the optimizer state are
# interleaved inside the same shards, so the whole directory has to be copied
# (~184 GiB) even though inference only reads the model.* tensors. .metadata
# is required to load; trainer_state.pt is not, but it is tiny.
DIT_SRC="${DIT_SRC:-/mnt/pub_share/zhangcheng/experiments/2026-09-22-14b-ar-tf-full-20e1c566/ckpts/step_008000}"
DIT_DST="$DST_HF/dit/2026-09-22-14b-ar-tf-full-20e1c566/step_008000"
echo
if [ -n "${SKIP_DIT:-}" ]; then
  echo "[SKIP] 14B AR DiT DCP  (SKIP_DIT is set)"
  skipped=$((skipped + 1))
elif [ -d "$DIT_SRC" ]; then
  echo "=== 14B AR DiT DCP -> $DIT_DST ==="
  mkdir -p "$DIT_DST"
  if rsync "${RSYNC_ARGS[@]}" "$DIT_SRC/" "$DIT_DST/"; then
    ok=$((ok + 1))
  else
    echo "  !! FAILED: $DIT_SRC"
    fail=$((fail + 1))
  fi
else
  echo "[SKIP] 14B AR DiT DCP  (not found at $DIT_SRC)"
  skipped=$((skipped + 1))
fi

# 5B rollout-DMD DiT checkpoint (DCP), the Stage-3 SGF run behind
# ``game2v-eden-world-v2-5b``. Inference reads only the distilled EMA subtree
# (``algorithm.rollout_dmd.ema_transformer.*``, 5.0B fp32 tensors), but that
# subtree is interleaved with the live generator, the fake score and the
# optimizer inside the same 65 shards, so the whole ~132 GiB step directory has
# to come across. Override DIT_5B_SRC to stage a different step.
DIT_5B_EXPERIMENT="wan22_5b-proxy2fine-channelconcat-stage3-sgf-datagame-720p-lr2e6-4e7"
DIT_5B_STEP="${DIT_5B_STEP:-step_002600}"
DIT_5B_SRC="${DIT_5B_SRC:-/mnt/pub_share/huangzehuan/experiments/EASYVIDEO_OUTPUT/$DIT_5B_EXPERIMENT/ckpts/$DIT_5B_STEP}"
DIT_5B_DST="$DST_HF/dit/$DIT_5B_EXPERIMENT/$DIT_5B_STEP"
echo
if [ -n "${SKIP_DIT_5B:-}" ]; then
  echo "[SKIP] 5B rollout-DMD DiT DCP  (SKIP_DIT_5B is set)"
  skipped=$((skipped + 1))
elif [ -d "$DIT_5B_SRC" ]; then
  echo "=== 5B rollout-DMD DiT DCP -> $DIT_5B_DST ==="
  mkdir -p "$DIT_5B_DST"
  if rsync "${RSYNC_ARGS[@]}" "$DIT_5B_SRC/" "$DIT_5B_DST/"; then
    ok=$((ok + 1))
  else
    echo "  !! FAILED: $DIT_5B_SRC"
    fail=$((fail + 1))
  fi
else
  echo "[SKIP] 5B rollout-DMD DiT DCP  (not found at $DIT_5B_SRC)"
  skipped=$((skipped + 1))
fi

echo
echo "Copied $ok item(s), failed $fail, skipped $skipped."
echo
echo "Now point the runtime at the copy:"
echo "  export HF_HOME=$DST_HF"
echo "  export HF_HUB_OFFLINE=1"