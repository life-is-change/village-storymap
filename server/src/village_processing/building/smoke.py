import argparse
import json
import os
from pathlib import Path

from .engine import BuildingEngine


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=os.environ.get("PLATFORM_MODEL_CONFIG"))
    parser.add_argument("--checkpoint", type=Path, default=os.environ.get("PLATFORM_MODEL_CHECKPOINT"))
    parser.add_argument("--threshold", type=float, default=0.35)
    parser.add_argument("--batch", type=int, default=1)
    args = parser.parse_args(argv)
    artifact = BuildingEngine(args.config, args.checkpoint).process(
        args.input, args.output, args.threshold, args.batch
    )
    print(json.dumps({"ok": True, "features": artifact.feature_count, "sha256": artifact.sha256}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
