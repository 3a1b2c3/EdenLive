<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Eden Cam2V

Install the Eden integration and launch its `cam2v-eden` application:

```bash
uv sync --package flashdreams-eden --inexact
uv run --no-sync flashdreams-run-v2 cam2v-eden \
  --mode webrtc --host 0.0.0.0 --port 8089 -- --example-data
```

Available application slugs:

| Application slug | Pipeline config |
| --- | --- |
| `cam2v-eden` | `PIPELINE_EDEN_WORLD_FAST_TAEHV_WINDOW15_SINK3` |
| `cam2v-eden-world-fast` | `PIPELINE_EDEN_WORLD_FAST` |
| `cam2v-eden-world-fast-taehv-window15-sink3` | `PIPELINE_EDEN_WORLD_FAST_TAEHV_WINDOW15_SINK3` |
| `cam2v-eden-world-v2-14b-causal-fast` | `PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST` |
| `cam2v-eden-world-v2-14b-causal-fast-taehv-window15-sink3` | `PIPELINE_EDEN_WORLD_V2_14B_CAUSAL_FAST_TAEHV_WINDOW15_SINK3` |

`cam2v-eden` remains the short compatibility alias for the bounded-window
TAEHV default. All variants use the same Cam2V application defaults.

To load FlashVSR once and expose the **Post-processing** checkbox, start with
`--postprocess-preset flashvsr-v1.1-sparse-1.5 --postprocess-chunk-size 8`.
The 8-frame setting adapts Eden's 9-frame first block and 12-frame steady
blocks. Add `--no-postprocess-compile` for development smoke tests.

Add `--postprocess-comparison-ui` to show the original frames on the left and
FlashVSR output on the right while the rollout runs. This doubles the delivered
video width for an accurate visual comparison.

See the shared [Cam2V README](../../../../apps/cam2v/README.md) for controls,
application arguments, defaults, and tests. See the
[Eden integration README](../../README.md) for model details.
