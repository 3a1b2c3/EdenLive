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

CONFIG_ROOT = Path(__file__).resolve().parents[1] / "configs" / "inference"


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
