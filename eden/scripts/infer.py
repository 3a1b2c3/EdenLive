from __future__ import annotations

import argparse

from eden.core.config import apply_overrides, load_config
from eden.inference.offline import run_offline_inference


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("overrides", nargs="*")
    args = parser.parse_args()

    config = apply_overrides(load_config(args.config), args.overrides)
    run_offline_inference(config)


if __name__ == "__main__":
    main()
