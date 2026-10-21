# Running EdenLive outside SM90

Notes from bringing the offline 5B path up on a GB300 (Blackwell) and a Windows
RTX 5090, against a README that targets Linux, conda and 80 GB Hopper GPUs.

## The flash4 wall

The reference 5B profile uses FA4 temporal text attention. `validate_flash4_environment`
tests compute capability for **equality** with `(9, 0)`:

```python
if torch.cuda.get_device_capability(device) != (9, 0):
    raise RuntimeError("This Wan flash4 integration currently targets SM90 (Hopper); other GPUs are unvalidated")
```

So no CUDA, driver or torch version admits Blackwell -- CUDA 13.2 and a cu130
build still fail. Two config settings have to change, and they are not
independent:

| Setting | Value | Why |
|---|---|---|
| `model.teacher_forcing_attention_backend` | `triton` | `validate_backend_name` accepts only `triton` or `flash4` |
| `model.dynamic_prompt.enabled` | `false` | its validator *requires* flash4, so it cannot fall back, only switch off |
| `data.dataset.params.text_mode` | `global` | `timeline` emits a `text_timeline` condition the adapter rejects while dynamic prompting is off |

The third is easy to miss: disabling dynamic prompting alone gets past the
attention check and then fails later in `encode_generation_prompts` with
`text_timeline requires model.dynamic_prompt.enabled=true`. The data and model
settings must agree.

**Cost of the workaround.** Timestamped `dynamicPrompts` are ignored and
`staticPrompt` applies to the whole clip. Geometry and motion still come from
the reference video, so clips render; appearance simply cannot change
mid-sequence. For recordings whose `dynamicPrompts` is empty, such as
`examples/city_racer`, nothing is lost.

`edenlive/configs/wan22_5b_720p_bidir.yaml` now carries these defaults with
comments. Revert them on Hopper to regain the reference profile.

## Weights: 36.6 GB, not 210 GB

The full repository is about 210 GB. The 5B bidirectional offline path reads
four directories:

| Directory | Size |
|---|---|
| `dit-5b-bidir` | 20.0 GB |
| `umt5` | 11.4 GB |
| `vae-5b` | 2.8 GB |
| `vision-encoder` | 2.4 GB |

The 14B DiTs are 65.7 GB each, `flux-c2f` 34.8 GB and `clip` 1.3 GB; none is
read by this path. The real-time service additionally needs `flux-c2f` for
first-frame generation and `decoder-5b` for TAEHV streaming decode.

`huggingface_hub.commands.huggingface_cli` no longer exists in current hub
releases, and `hf download` is the replacement CLI. The scripts call
`snapshot_download` with `allow_patterns` instead, which depends on neither.

## Scripts

| Script | Purpose |
|---|---|
| `setup_and_run_example.sh` / `.bat` | venv, torch cu130, deps, 5B weights, runs the example |
| `run_example.sh` | runs the example, reading compute capability and choosing the attention path |
| `setup_and_run_live.sh` | real-time Workbench: extra weights, playwright, npm, TURN config, four services |

`run_example.sh` branches on `torch.cuda.get_device_capability()`, so the flash4
overrides cannot be forgotten on non-Hopper hardware.

## Reference scenes

A scene is three files and a manifest row:

```
my_scenes/manifest.csv                 id, prompt, proxy_video, first_frame
my_scenes/shot_001/recording.mp4       the proxy: greybox geometry and motion
my_scenes/shot_001/cover.png           photoreal first frame, the appearance target
my_scenes/shot_001/prompts.json        staticPrompt and dynamicPrompts
```

```bash
python -m edenlive.scripts.infer --config CONFIG.yaml \
  data.dataset.params.path=/data/my_scenes/manifest.csv \
  data.dataset.params.root=/data/my_scenes
```

The proxy carries geometry and motion only; the encoder is trained so reference
appearance does not leak into the output, which is why untextured blocks work.
Appearance comes from `cover.png` and the prompt.

`examples/city_racer` shipped without the `cover.png` its manifest names, only a
generated JPEG. `cover.png` is that image centre-cropped to the proxy's aspect
and resized to 1280x704; cover and proxy must register, so matching aspect by
cropping rather than stretching matters.

## Frame rates

| | Frames | Rate | Duration |
|---|---|---|---|
| `recording.mp4` (proxy in) | 241 | 24 fps | 10.0 s |
| `taxi-crash-reverse.mp4` (render out) | 241 | 24 fps | 10.0 s |
| `taxi-crash-reverse_proxy.mp4` (written out) | 61 | 6 fps | 10.2 s |

Generation is **1:1 with the proxy**, not interpolated. The 61-frame file is the
conditioning stream at latent rate: 241 / 4 matches
`proxy_dino.vae_time_compression_ratio: 4`.

`fps` is fixed at 24 in both the dataset and inference sections, so a proxy at
another rate is resampled rather than honoured. Note also that `max_frames: 121`
did not cap a 241-frame render -- the recording metadata supplies the actual
count, so clip length is bounded through `durationMs` in `prompts.json`.

## What the renders show

A 10 s city clip took 177 s on one GB300. Flat grey massing became brick and
concrete facades with window detail, textured road surface, a structured sunset
sky, working traffic lights and legible gate signage, with gate position, lane
markings and camera path faithful to the proxy.

Two failure modes were consistent across runs:

- **Fast lateral motion at frame edges smears.** A clean box car in the proxy
  renders as a dark blur; a pedestrian did the same.
- **Geometry absent from the proxy is not recovered.** The prompt and cover
  describe several checkpoint gates and a checkered finish gate; the proxy
  contains one gate, and the render contains one gate. Reference control is a
  floor as well as a ceiling: the model renders what the proxy gives it.
