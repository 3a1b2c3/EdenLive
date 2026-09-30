<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Eden World

Eden World is a streaming camera-controlled image-to-video model integration.
Its public model variants are `StreamInferencePipelineConfig` literals in
`eden.config`; the reusable Cam2V application owns interactive I/O.

## Pipeline configurations

- `PIPELINE_EDEN_WORLD_FAST` — v1 (robbyant/eden-world-fast)
- `PIPELINE_EDEN_WORLD_FAST_TAEHV_WINDOW15_SINK3` — v1 with LightTAE decoding
- `PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST` — v2 14B distilled 4-step streaming
- `PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6` — same with LightTAE decoding
- `PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST` — v2 1.3B distilled 4-step streaming
- `PIPELINE_EDEN_WORLD_V2_1PT3B_CAUSAL_FAST_TAEHV_WINDOW18_SINK6` — same with LightTAE decoding
- `PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_PRETRAIN` — v2 14B 40-step UniPC + CFG 5.0

All v2 presets follow the upstream launch config: 4-step grid
`[1000, 750, 500, 250]`, sliding window 18 frames with a 6-frame sink,
shift 10.0 (14B) / 5.0 (1.3B), and chunk size 3 (the flashdreams `len_t`).

## Install

```bash
uv sync --package flashdreams-eden --inexact
```

Checkpoints download from Hugging Face on first use. Export `HF_TOKEN` when the
selected repository requires authentication.

## Cam2V application

```bash
uv sync --package flashdreams-eden --inexact
uv run --no-sync flashdreams-run-v2 cam2v-eden \
  --mode webrtc --host 0.0.0.0 --port 8089 -- --example-data
```

Shared [`apps/cam2v`](../../apps/cam2v/README.md) documentation lists controls,
application arguments, and development commands.

## Programmatic pipeline access

```python
from eden.config import PIPELINE_EDEN_WORLD_FAST

pipeline = PIPELINE_EDEN_WORLD_FAST.setup().to("cuda").eval()
```

## Tests

```bash
uv run --no-sync pytest integrations_v2/eden -m ci_cpu
```

## Game2V HUD

Game HUD is HTML over the generated-video letterbox, not pixels in the JPEG
stream. FlashDreams forwards a generic `{type, slug, frame_id, state}` envelope
and `{type: "client_action", channel: "game_ui", action}` clicks; it does not
interpret `state`. Each game under `games/<slug>/hud/` owns:

- `transport.mjs` — encode a snapshot from `runtime.read()`
- `overlay.js` / `overlay.css` — paint that snapshot on the WebRTC page

v1 covers live stats, toast, cue, help/result dialogs and Undo/Hint/Reset.
Video click-to-walk and the touch d-pad stay out. Keyboard WASD/arrows/R still
go through the existing `keyboard` events.

## Pausing while nobody is connected

In `--mode webrtc`, a run with no browser attached generates nothing: the model
loop takes no step, so no chunk is generated and the game simulation does not
advance either. The rollout resumes from where it stopped when a browser
connects, on the same game timeline and model cache.

The pause is one decision per model step, broadcast from rank 0 with the input
batch, so all ranks skip the same steps and no collective is left half-entered.
Input that arrived just before a disconnect is delivered to the first step after
a reconnection, paused polls do not count against `--steps`, and a client that
asked to close still ends the run without reconnecting. `mp4` and
`native-window` always have somewhere to put frames, so they never pause.
