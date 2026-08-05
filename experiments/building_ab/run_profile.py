"""Run one Linux-compatible building inference profile for A/B comparison."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_SRC = REPO_ROOT / "server" / "src"


def apply_profile(module, profile: str) -> tuple[int, int]:
    if profile == "source_like":
        module.MIN_INSTANCE_PIXELS = 25
        module.MAX_ASPECT_RATIO = float("inf")
        module.MIN_RECT_FILL_RATIO = 0.0
        module._is_in_center = lambda mask: True
        return 512, 128
    if profile == "strict":
        module.MIN_INSTANCE_PIXELS = 150
        module.MAX_ASPECT_RATIO = 8.0
        module.MIN_RECT_FILL_RATIO = 0.45
        return 1536, 384
    if profile == "balanced":
        module.MIN_INSTANCE_PIXELS = 60
        module.MAX_ASPECT_RATIO = 12.0
        module.MIN_RECT_FILL_RATIO = 0.30
        module._is_in_center = lambda mask: True
        return 1024, 256
    raise ValueError(f"Unknown profile: {profile}")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=("source_like", "strict", "balanced"))
    parser.add_argument("tif", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--score-threshold", type=float, default=0.35)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sys.path.insert(0, str(SERVER_SRC))
    from mmdet.apis import init_detector
    from village_processing.building import legacy_pipeline

    tile_size, overlap = apply_profile(legacy_pipeline, args.profile)
    started = time.perf_counter()
    model = init_detector(str(args.config), str(args.checkpoint), device="cuda:0")
    legacy_pipeline.process_tif(
        model=model,
        tif_path=args.tif,
        output_geojson=args.output,
        score_threshold=args.score_threshold,
        batch_size=1,
        tile_size=tile_size,
        overlap=overlap,
    )
    elapsed = time.perf_counter() - started
    payload = json.loads(args.output.read_text("utf-8"))
    print(json.dumps({
        "profile": args.profile,
        "features": len(payload["features"]),
        "elapsed_seconds": round(elapsed, 2),
        "tile_size": tile_size,
        "overlap": overlap,
        "output": str(args.output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
