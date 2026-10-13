# Principle Agent Guide

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

# FlashDreams Agent Guide

FlashDreams is a GPU-heavy inference and serving library for autoregressive video and world models. Default to inspection, docs, config checks, and CPU tests unless the user explicitly asks to run generation or GPU workflows.

Start here, then use the narrower docs for the task in front of you:

- `README.md` covers user-facing setup, requirements, the shipped models, and first-run commands.
- `CONTRIBUTING.md` covers coding conventions, test markers, and dependency rules.

This is a deployment-only fork of [upstream FlashDreams](https://github.com/NVIDIA/flashdreams),
trimmed to the two Eden game2v models. The docs site, the Agent Skills, the
benchmark suites and the other 20 integrations live upstream, not here.

## Repo Map

- `integrations_v2/eden/` — the Eden integration: `apps/game2v` (the two shipped
  models), `apps/cam2v`, and `impl/` (pipelines, encoders, transformers).
- `apps/{cam2v,v2v}` — dependencies of the eden package; `game2v` imports
  `Cam2VConditioning` from `cam2v`. `integrations_v2/flashvsr/` ships in the tree
  but nothing in game2v imports it, so the serving install leaves it out.
- `flashdreams/flashdreams/` — the framework code eden reaches: `api_v2`,
  `infra/{config,diffusion,encoder,postprocess}`, `plugins`,
  `recipes/{wan,taehv}`, `runtime`, `runtime_v2`, `serving`, `core`.
- `games/` — runtime data, not code. `game_renderer` reads `games/registry.json`
  for each slug's cover and prompt; `EDEN_GAMES_ROOT` overrides the location.
- `run.py` / `start.sh` — the deployment entrypoints.

## Common Commands

```bash
pip install -r requirements.txt        # after the torch and -e steps in README.md
flashdreams-run --help
flashdreams-run <runner-name> --help
flashdreams-run --no-instantiate <runner-name>
pre-commit run -a
pytest integrations_v2/eden/tests
bash start.sh 5b                          # or 14b; --no-compile skips compilation
```

`start.sh` resolves the application slug and runs `run.py` under `torchrun` in
`webrtc` mode. The other test trees and the docs build left with the upstream
integrations; `integrations_v2/eden/tests/` is the only suite here.

Use `--no-instantiate` before GPU work to inspect the resolved runner config without constructing models or loading checkpoints.

## No-GPU Workflow

- Inspect available runners with `flashdreams-run --help`, then inspect a specific runner with `flashdreams-run --no-instantiate <runner-name>`.
- Prefer CPU checks first: config imports, checkpoint key-remap shape/bijection tests on CPU or meta tensors, docs builds, `pytest -m ci_cpu`, and static assertions about runner names and pipeline wiring.
- Avoid `ci_gpu`, generation, `torchrun`, Docker GPU tests, large Hugging Face downloads, rollout parity, CUDA graph, WebRTC runtime, and quality-regression tests on CPU-only hosts unless the user requests them or the test explicitly skips cleanly.

## Testing Guidance

Every pytest test must carry exactly one of `ci_cpu`, `ci_gpu`, or `manual`; `CONTRIBUTING.md` has the exact rules, including how pytest discovers files and functions (`test_*.py`, `test_*`). Use module-level `pytestmark = pytest.mark.ci_cpu` for pure Python/metadata tests. Keep GPU, `libGL`/`cv2`, large-checkpoint, credential, and download-heavy checks out of `ci_cpu`.

**Test ownership** — put a new test next to the thing it validates. In this fork
that means `integrations_v2/eden/tests/`; the framework and app suites left with
the upstream integrations.

## Dependencies

- `infra` depends on `core` — never the other way around. `core` stays model-agnostic.
- `recipes`/`integrations_v2` depend on `infra` and `core` — never the other way around. Expose a generic config slot or override hook in `core`/`infra` instead of adding model-specific branches. Built-in reusable model pieces belong in `flashdreams/flashdreams/recipes/`; standalone plugin packages belong in `integrations_v2/<name>/`.
- `apps/<name>/` depends on `flashdreams` — never the other way around. An app is written against the framework, not against any one model: it must run against a stub network, and binding a real model is the adapter's job.
- `integrations_v2/<model>/` depends on `flashdreams` and on the app it adapts for (via its own `integrations_v2/<model>/apps/<demo>/adapter.py`) — never the other way around.

Because of this direction, tests in `apps/<name>/tests/` must not import from `integrations_v2/` — an app's tests run against a stub, and model-specific checks belong in `integrations_v2/<model>/tests/`. CI enforcement of this is a separate follow-up, not yet built.

## Known Pitfalls

- FlashDreams targets large NVIDIA GPUs; many real rollouts need 80 GB VRAM and CUDA-capable dependencies.
- Installing pulls only what [`requirements.txt`](requirements.txt) lists. Transformer Engine and the other CUDA-only packages are not part of it.
- `flashdreams-run --no-instantiate` resolves config only; it does not prove weights, CUDA execution, or parity.
- First GPU runs include compile/autotune warmup, so benchmark harnesses should discard warmup chunks.
- Plain `pytest` includes manual tests. Use `pytest -m ci_cpu` or `pytest -m "not manual"` for normal local validation.

## Troubleshooting Links

- Setup and requirements: `README.md`
- Architecture: `ARCHITECTURE.md`
- Repository workflow notes: `DEV.md`
- Security reports: `SECURITY.md`
- Everything else (docs site, CLI reference, integration guides): [upstream FlashDreams](https://github.com/NVIDIA/flashdreams)

## API Documentation

### API v2

#### Threading

Only contains two threads during a program runtime:
- model-thread: responsible for generating model output. Drives model loop.
- ui-thread: responsible for compositing and presenting the model output to the user. Additionally manages the state of `run_session` which includes content such as user event collection, and client window management. Drives ui loop.
