#!/usr/bin/env bash
# 用法：bash start.sh <模型> [on|off]
# 第二个参数控制模型推理优化：on 保持默认 compile/缓存优化，off 关闭
# transformer compile，适合只关心尽快得到首个 chunk 的调试场景。
# 模型选择：bash start.sh [eden-game2v-5b-taehv|eden-game2v-14b-taehv]
#
# 卡数由 NPROC 决定（默认 8）：NPROC=2 bash start.sh eden-game2v-5b-taehv
# 游戏由 EDEN_GAME 决定（默认 subway-run），slug 见 games/registry.json。
#
# 这个脚本是不带 workbench 的老路径：开进程就直接出画，没有首页门控。
# 要用工作台（首页选游戏、生成新游戏）走 launch.sh，见 README.md。

# run.py 与 games/ 都在本脚本所在目录下，torchrun 必须从那里启动。
cd "$(dirname "$(readlink -f "$0")")" || exit 1

# 先校验参数再动手清理，避免拼错名字时把正在跑的会话杀掉。
MODEL="${1:-eden-game2v-5b-taehv}"
OPTIMIZE="${2:-on}"
case "$OPTIMIZE" in
  on|off) ;;
  *) echo "第二个参数必须是 on 或 off，当前为: ${OPTIMIZE}" >&2; exit 1 ;;
esac
case "$MODEL" in
  eden-game2v-5b-taehv)
    APP_SLUG="game2v-eden-world-v2-5b-taehv"
    ;;
  eden-game2v-14b-taehv)
    APP_SLUG="game2v-eden-world-v2-14b-taehv"
    ;;
  *)
    echo "未识别的模型: ${MODEL}（支持 eden-game2v-5b-taehv、eden-game2v-14b-taehv）" >&2
    exit 1
    ;;
esac
GAME_ARGS=(--game "${EDEN_GAME:-subway-run}")
echo "启动模型: ${MODEL} -> ${APP_SLUG}"
echo "推理优化: ${OPTIMIZE}"

# 清理上一次残留的进程：WebRTC 服务常驻不退，会占着 8089 和 torchrun 的
# rendezvous 端口(23456)，重新 start.sh 时触发 EADDRINUSE。
# 先找出占用 8089 的进程并杀掉，再兜底清掉整组 torchrun/worker。
_PID_8089=$(ss -ltnp 2>/dev/null | grep ':8089 ' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)
if [ -n "$_PID_8089" ]; then
  echo "杀掉占用 :8089 的旧进程 pid=${_PID_8089}"
  kill -9 "$_PID_8089" 2>/dev/null || true
fi
pkill -9 -f '[r]un.py' 2>/dev/null || true

if [ -z "${EDEN_MODEL_ROOT:-}" ]; then
  if [ -d /mnt/workspace/models/EdenLive ]; then
    EDEN_MODEL_ROOT=/mnt/workspace/models/EdenLive
  else
    EDEN_MODEL_ROOT=/mnt/workspace/models/EdenLive
  fi
fi
export EDEN_MODEL_ROOT HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1
# TURN 必须指向一台活着的 relay：填了不存在的地址会让浏览器卡在
# "gathering candidates" 10 秒然后失败，而不是退回 host candidate。
# localhost 那台已经没了，现在默认用 pod 自己跑的 coturn（turn_server.sh）。
export FLASHDREAMS_TURN_HOST="${FLASHDREAMS_TURN_HOST:-localhost}" \
       FLASHDREAMS_TURN_PORT="${FLASHDREAMS_TURN_PORT:-3478}" \
       FLASHDREAMS_TURN_USERNAME="${FLASHDREAMS_TURN_USERNAME:-flashdreams}" \
       FLASHDREAMS_TURN_CREDENTIAL="${FLASHDREAMS_TURN_CREDENTIAL:-turnsecret}"
torchrun --nproc_per_node="${NPROC:-8}" run.py \
  "${APP_SLUG}" --mode webrtc --host 0.0.0.0 --port 8089 -- --no-ui --example-data --total-blocks 10000 \
  $(if [ "$OPTIMIZE" = off ]; then echo --no-compile; fi) "${GAME_ARGS[@]}" \
  > .eden_app.log 2>&1 &
echo "started pid=$!"
tail -f .eden_app.log
