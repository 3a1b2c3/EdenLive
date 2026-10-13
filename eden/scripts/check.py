"""Static smoke check: every shipped config composes into a dispatchable run.

Catches the breakage class that is cheap to introduce and expensive to find on a
GPU: a config that no longer loads, names a strategy or adapter that does not
exist, declares an output the adapter cannot produce, or selects a runtime
plugin that is not registered. None of this needs weights or a device, so it
runs in about a second on CPU.

    python -m eden.scripts.check

It does not exercise the model forward, the schedulers' numerics, or the cache.
A change to any of those still needs a real inference run.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

from eden.core.config import load_config
from eden.core.factory import build_model_adapter, build_runtime_plugins
from eden.inference.strategies import default_strategies

CONFIG_ROOT = Path(__file__).resolve().parents[1] / "configs"


def check_config(path: Path, strategies: dict) -> list[str]:
    """Return a list of problems with one inference config (empty when clean)."""

    problems: list[str] = []
    config = load_config(path)

    inference = config.get("inference")
    if not isinstance(inference, dict):
        return ["no inference: block"]

    strategy = inference.get("strategy")
    if strategy not in strategies:
        problems.append(f"strategy {strategy!r} not in {sorted(strategies)}")

    if not inference.get("output_dir"):
        problems.append("no inference.output_dir")

    adapter = build_model_adapter(config)
    outputs = tuple(inference.get("outputs") or ())
    if not outputs:
        problems.append("no inference.outputs")
    elif not adapter.capabilities.supports_outputs(outputs):
        problems.append(f"adapter cannot produce outputs {outputs}")

    conditions = tuple(inference.get("conditions") or ())
    if conditions and not adapter.capabilities.supports_conditions(conditions):
        problems.append(f"adapter cannot consume conditions {conditions}")

    if not build_runtime_plugins(config):
        problems.append("no runtime plugins selected")

    # The proxy-DINO projection is the one piece of the config a GPU run dies on
    # that this check can see: the layer's shape is fixed by patchify_factor, and
    # the published checkpoint has to match it. Checked without loading the
    # backbone, which is the slow part.
    proxy = config.get("model", {}).get("proxy_dino") if isinstance(config.get("model"), dict) else None
    if isinstance(proxy, dict) and proxy.get("enabled"):
        problems.extend(check_proxy_dino_projection(config, proxy))

    # _select_inference_loader falls back to the prompt loader when the config
    # asks for it or carries no data: block at all, so a missing dataset is only
    # a problem when neither of those holds.
    prompt_only = bool(inference.get("use_prompt_loader")) or "data" not in config
    if prompt_only:
        if not inference.get("prompt"):
            problems.append("prompt-only run with no inference.prompt")
    elif not config.get("data", {}).get("dataset", {}).get("name"):
        problems.append("data: block with no data.dataset.name")

    return problems



def check_proxy_dino_projection(config, proxy: dict) -> list[str]:
    """The projection checkpoint must load into the layer the config builds."""

    from safetensors import safe_open

    factor = int(proxy.get("patchify_factor", 1))
    control_dim = int(proxy.get("control_dim", 1024))
    checkpoint = proxy.get("checkpoint_path")
    if not checkpoint:
        return ["proxy_dino enabled with no checkpoint_path"]
    # Same rule as Wan22DiffusersAdapter._under_pretrained_dir: absolute paths
    # stand, anything else is read under model.pretrained_dir.
    raw = Path(str(checkpoint)).expanduser()
    root = str((config.get("model") or {}).get("pretrained_dir") or "")
    path = raw if raw.is_absolute() or not root else Path(root).expanduser() / raw
    if not path.is_file():
        return [f"proxy_dino checkpoint not found: {path}"]
    try:
        with safe_open(path, framework="pt") as handle:
            keys = list(handle.keys())
            # The training checkpoint prefixes the key
            # (model.module.encoder.patch_projection.weight); the loader strips
            # those prefixes, so match on the suffix.
            weight = next((key for key in keys if key.endswith("patch_projection.weight")), None)
            shape = tuple(handle.get_slice(weight).get_shape()) if weight else None
            cls_token = next((key for key in keys if key.endswith("embeddings.cls_token")), None)
            hidden_size = handle.get_slice(cls_token).get_shape()[-1] if cls_token else None
    except Exception as exc:
        return [f"proxy_dino checkpoint {path.name} is not readable: {exc}"]
    if shape is None:
        return [f"proxy_dino checkpoint {path.name} has no patch_projection.weight"]
    if hidden_size is None:
        return [f"proxy_dino checkpoint {path.name} has no cls token to read the token width from"]
    # The layer the config builds is (control_dim, hidden_size * factor**2): one
    # DINO token is hidden_size wide and a factor of f groups fxf of them.
    expected = (control_dim, int(hidden_size) * factor**2)
    if shape != expected:
        return [
            f"proxy_dino patch_projection is {shape}, but patchify_factor={factor} with "
            f"control_dim={control_dim} builds {expected}"
        ]
    return []



def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--configs",
        default=str(CONFIG_ROOT),
        help=f"directory to scan recursively for *.yaml (default: {CONFIG_ROOT})",
    )
    args = parser.parse_args()

    root = Path(args.configs)
    paths = sorted(root.rglob("*.yaml"))
    if not paths:
        print(f"no configs found under {root}", file=sys.stderr)
        return 1

    strategies = default_strategies()
    failures = 0
    for path in paths:
        name = path.relative_to(root)
        try:
            problems = check_config(path, strategies)
        except Exception:
            print(f"FAIL {name}")
            print(traceback.format_exc().rstrip())
            failures += 1
            continue
        if problems:
            print(f"FAIL {name}")
            for problem in problems:
                print(f"       {problem}")
            failures += 1

    print(f"\n{len(paths)} configs checked, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
