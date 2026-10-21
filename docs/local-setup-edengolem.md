# EdenLive and EdenGolem: local setup and measured facts

## TL;DR

- Scene generation is the EdenGolem skill. It builds a standalone Three.js browser game from a text description. Use it from a new Claude Code session; it is linked at user level, so any folder works.
- Python for the skill's checks: `C:\workspace\world\EdenLive\.venv\Scripts\python.exe` (Python 3.11.15, Playwright 1.64.0). Chromium is installed under `C:\Users\kschmid\AppData\Local\ms-playwright`.
- Playing a game rendered live by the EdenLive model needs the DGX service, which is not set up: missing weights and tools (see "DGX state").
- The released offline mode generates at about 1.7 fps (121 frames of 1280x704 in about 70 s). The real-time mode is the few-step chunked model, 3 latent frames per chunk.

## Using scene generation (EdenGolem)

1. Create and enter a clean output folder, then start Claude Code there:
   `mkdir C:\workspace\world\EdenGolem_games`, `cd C:\workspace\world\EdenGolem_games`, `claude`.
2. Tell the session which Python to use and where to build, for example: "Use `C:\workspace\world\EdenLive\.venv\Scripts\python.exe`; create the game in `C:\workspace\world\EdenGolem_games\<name>`."
3. Describe the game. Scope: a silent desktop keyboard-and-mouse 3D scene, one continuous round, reachable win and loss states. Out of scope: 2D-only, audio-led, touch or gamepad-only, level-select games.
4. The skill runs one intake phase and three build stages: `scene` (step1), `behavior` (step2), `acceptance` (step3). Each ends with an automatic check and your review. At most three refinement rounds per stage.
5. The result is a standalone project with a copied `serve_step.py` and `launch.sh`.

## What is installed

| Item | Location |
| --- | --- |
| Skill link (directory junction) | `C:\Users\kschmid\.claude\skills\edengolem` -> `C:\workspace\world\EdenLive\realtime\skills\edengolem` |
| Skill Node packages (`acorn`, `three`) | `C:\workspace\world\EdenLive\realtime\skills\edengolem\node_modules` |
| Game Node packages (`three`, `three-demo`) | `C:\workspace\world\EdenLive\realtime\games\node_modules` (ignored by `realtime/.gitignore`) |
| Playwright 1.64.0 | `C:\workspace\world\EdenLive\.venv` |
| Chromium and ffmpeg for Playwright | `C:\Users\kschmid\AppData\Local\ms-playwright` |

`make` is not installed on Windows, so the skill's `make lint` and `make test-js` targets do not run here. They are not needed to generate a game.

## Offline inference (verified on the DGX)

- Command: `python -m edenlive.scripts.infer --config edenlive/configs/wan22_5b_720p_bidir.yaml`. Override the output folder with `inference.output_dir=<dir>`.
- Config: 5B bidirectional, 121 frames at 1280x704, 24 fps, 48 steps, guidance 3.0, seed 42. Output is deterministic: a rerun is byte-identical.
- Measured: 148 s for the two sample scenes. First sample 77 s (includes load and warm-up), second 70 s, which is about 1.7 fps of generation. The GPU was shared with another job (113 GB in use), so an idle GPU is probably faster.
- Outputs: `C:\workspace\world\EdenLive\dgx_inference_base\` (`cryo-crossing.mp4`, `pulse-skirmish.mp4`, proxies, first-frame images, request files, `resolved.yaml`). Source folder on the DGX: `/localhome/kschmid/EdenLive/inference/wan22_5b_720p_bidir/save/inference/base/`.

## Real-time mode

- Few-step chunk-autoregressive generation, 4 denoising steps per chunk, no classifier-free guidance.
- Chunk size: 3 latent frames (`chunk_size: 3` in `wan22_5b_720p_few_step.yaml`; the paper uses L = 3). About 12 pixel frames, 0.5 s at 24 fps, with the 4x temporal compression implied by `num_frames: 117`.
- Cache: 18 latent frames, 6 of them a permanent sink (`max_latent_frames: 18`, `sink_latent_frames: 6`).
- Paper figures (one H100, LightTAE decoding): 5B at 832x480 gives 73.52 fps, 5B at 1280x704 gives 29.80 fps, 14B on 8 H100 at 832x480 gives 26.76 fps. First-chunk latency 826 ms and 1162 ms for the 5B cases.
- RTX 5090: the README points to LightX2V (`ModelTC/LightX2V`, `scripts/edenlive/run_5090.sh`): about 24.7 fps at 1280x704, 28.4 GiB peak, INT8 and FP8 quantized weights. Not run here.
- Paper comparison with AgentGarten (832x480, one H100): EdenLive 73.52 fps with 3 latent frames per chunk; AgentGarten 36.14 fps with 4.

## DGX state (`kschmid@10.74.11.118`, `/localhome/kschmid/EdenLive`)

No EdenLive service is running. The workbench and live service cannot start yet:

- Weights present: `dit-5b-bidir`, `scheduler-5b`, `umt5`, `vae-5b`, `vision-encoder`. Missing: `dit-5b` (few-step), `decoder-5b`, `clip`, and `flux-c2f` for the workbench.
- Tools missing: `node`, `playwright` in the DGX venv, `coturn`, the `claude` CLI.
- The service needs a GPU with 80 GB or more (README). The model service is `realtime/start.sh 5b`; the workbench adds `turn_server.sh`, `workbench_bridge.sh`, `workbench_flux.sh` and `launch.sh`.
- FLUX.2 klein is under a non-commercial license and requires content filtering.

## What the model conditions on

- A proxy video, encoded by a Proxy-DINO vision encoder (`proxy_dino`, channel-concat injection), plus text (a static prompt and timed dynamic prompts) and a first frame.
- No semantic or segmentation map input. The encoder is fine-tuned to ignore the reference's appearance and keep layout and motion, so proxy colours are not meaningful labels; the first frame and prompt set the look.

## Training code

- EdenLive: none released. Only `edenlive/scripts/infer.py`; no optimizer or loss code.
- AgentGarten (`C:\workspace\world\AgentGarten`): training code is released. Launch with `bash scripts/run.sh experiment=cosmos3/<name>`; configs in `wm/configs/experiments/cosmos3/` cover bidirectional, autoregressive (teacher and diffusion forcing) and distillation (`dmd`, `dmd_gan`, `dmd_gan_exact`, `dmd_gan_lora`).

## Known loose ends

- Untracked files in the repo root left by failed npm runs: `package-lock.json` and `games\package-lock.json`. Safe to delete.
- Torch in `.venv` was 2.13.0+cu130 with CUDA before Playwright was added; the install added only `playwright`, `greenlet`, `pyee`.
