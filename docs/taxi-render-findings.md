# Taxi game renders on EdenLive: measured results and behavior

Findings from rendering recorded clips of a low-poly taxi game (the EdenGolem `city_racer` project, and a second gameplay recording in
`examples/sony_taxi`) with EdenLive on the DGX (NVIDIA GB300, Blackwell SM100, shared with another user's job, 5B models, 1280x704, 24 fps).
Measured 2026-10-20 and 2026-10-21. Numbers are single runs unless noted.

## Setup

| Item | Value |
| --- | --- |
| Bidirectional model | `models/EdenLive/dit-5b-bidir` (fp32, 20.05 GB), config `wan22_5b_720p_bidir.yaml`, 48 steps, guidance 3.0 |
| Autoregressive (few-step) model | `models/EdenLive/dit-5b` (fp32, 20.05 GB), config `wan22_5b_720p_few_step.yaml`, 4 steps, guidance 1.0, chunk of 3 latent frames |
| Scripts | `render_sample.sh` (bidirectional), `render_sample_ar.sh` (autoregressive) |
| Sample layout | `manifest.csv` plus `<id>/recording.mp4` (proxy), `cover.png` (reference image), `prompts.json` |
| Frame counts | Bidirectional: `1 + 4n` (121, 241). Autoregressive: `12n - 3` (117, 129, ..., 237) |

Both scripts report the whole-run time and the speed without model loading (from the "components loaded" log line to the end).

## Speed

| Run | Frames | Whole run | Without model load |
| --- | --- | --- | --- |
| Autoregressive, crash clip | 237 | 28 to 30 s warm, 66 s cold | 21 to 23 s = 10.3 to 11.3 fps |
| Autoregressive, lane clip | 213 | 29 s | 20 s = 10.65 fps |
| Autoregressive, sony_taxi | 237 | 67 s | 59 s = 4.02 fps |
| Bidirectional, crash and lane clips | 241 | 173 to 174 s | 167 to 168 s = 1.43 to 1.44 fps |
| Bidirectional, sony_taxi | 241 | not recorded | 168 s = 1.43 fps |

- The autoregressive model is 2.6 to 7 times faster than the bidirectional one. The paper reports 29.8 fps on one H100 at 1280x704 for the
  real-time service, which is not set up on this DGX.
- The paper's streaming latency at 1280x704 on one H100: first chunk 1.16 s, 95th-percentile gap between chunks 0.39 s, real-time factor 0.54.
  Offline runs here have no per-chunk latency.
- Output is deterministic: the same inputs and seed give byte-identical files.

## What controls the result

| Input | Controls | Observed strength |
| --- | --- | --- |
| Proxy video (through Proxy-DINO) | Layout and motion | Strong. Vehicle position, road layout, gates and traffic follow the clip. |
| Cover image | Look, season, colors, building style | Strongest for the look. A snowy cover produces snowy renders under a "golden hour" prompt. |
| Prompt | Detail, mood, lighting changes | Secondary. |

- Proxy-DINO encodes one proxy frame per latent timestep (`vae_time_compression_ratio` 4, so 6 fps at 24 fps) at 480x832. This is fixed by the
  architecture. `inference.condition_video_fps` only sets the playback fps of the saved `*_proxy.mp4`; changing it from 6 to 12 produced a
  byte-identical render.
- Any text, HUD or player bar present in the proxy or cover is carried into the render. The `sony_taxi` cover shows a HUD and a video-player bar;
  both appear in every render.
- The autoregressive model renders the sony_taxi HUD text as garbled characters and replaces the speed readout with an icon. The bidirectional
  model keeps the HUD stable.
- Fast motion is outside the training distribution (the paper's data curation removes clips with fast rotation or abrupt viewpoint changes).
  Fast passes, gates filling the frame and heavy foliage blur are the weak spots.

## Dynamic prompts (timed text)

`prompts.json` accepts `dynamicPrompts` entries with `startMs`, `endMs` and `text`. Each latent frame's text is the static prompt, a space, and the
text of the windows covering it (`edenlive/data/recording_manifest.py`). Windows should start on 500 ms boundaries (one 3-latent chunk).

| Model | Status on the GB300 |
| --- | --- |
| Bidirectional | Works with `render_sample.sh --dynamic-prompts`, which sets `model.dynamic_prompt.enabled=true`, `backend=sdpa`, `text_mode=timeline`, `dynamic=true`. |
| Autoregressive | Works with `TEXT_MODE=chunk DYNAMIC=true bash render_sample_ar.sh ...`. The config already supports per-chunk text and does not use the flash4 module. |

- The reference `flash4` backend accepts only Hopper (SM90) GPUs. `dynamic_prompt.py` now has `backend: sdpa`, a plain PyTorch cross-attention in
  which each text segment's queries attend to that segment's own prompt bank. It matches a naive reference attention to 2.4e-7. The adapter
  supports dynamic prompts for the bidirectional path only.
- Tokens per segment are 226 to 278 of the 512 limit for the prompts tested; nothing is truncated.
- Weather schedule (clear golden hour, then clouds and first rain, heavy rain, stormy dusk) on the crash clip: visible but subtle. The
  bidirectional render shows a gray-blue sky, headlights on, a wet dark road and stormy dusk light; the autoregressive render shows a milder
  version. No rain streaks appear. The bidirectional run uses guidance 3.0 and the autoregressive run 1.0, which is consistent with the stronger
  text effect in the bidirectional render.
- Spell schedule (a glowing magical spell swirling, bursting, fading) on the same clip: almost no visible effect, only a faint bluish glow behind
  the taxi. The text was applied (verified in `*_text_timeline.json`), but it is about 30 of roughly 240 tokens next to a 206-token static prompt,
  and neither the proxy nor the cover contains a spell.

## Untested

- A short static prompt with strong dynamic text, and a higher guidance scale for the bidirectional model, as ways to strengthen timed text.
- Putting a glow effect into the proxy video so the prompt only has to style it.
- Recording the proxy at half speed and speeding the render up afterwards, for fast-motion errors.
- Guidance above 1.0 for the autoregressive model, which was distilled to run without it.

## Limitations stated in the paper (section 7)

Object identity between proxy and output is implicit; the bounded cache has no memory for fine appearance after occlusion; and the encoder offers
one fixed level of reference fidelity.

## Files

| Path | Purpose |
| --- | --- |
| `render_sample.sh`, `render_sample_ar.sh` | Render scripts with speed reporting |
| `edenlive/models/adapters/wan22_diffusers/dynamic_prompt.py` | Dynamic prompt module, including the `sdpa` backend |
| `docs/running-on-blackwell.md` | Running outside SM90 |
| `examples/city_racer/`, `examples/sony_taxi/`, `examples/city_racer_lanes/` | Sample folders |
| `inference/city_racer/` | Local copies of renders (not in git) |
