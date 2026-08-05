"""Apply adaptive footprint regularization to the existing strict-profile result."""

from __future__ import annotations

import json
from pathlib import Path

from regularize_footprints import regularize_feature_collection


ROOT = Path(r"E:\村规平台学生体验版\建筑矢量")
INPUT = ROOT / "output_result" / "ab_compare_20260727" / "strict" / "buildings.geojson"
OUTPUT_DIR = ROOT / "output_result" / "ab_compare_20260727" / "regularization_v1"
OUTPUT = OUTPUT_DIR / "buildings_regularized.geojson"
STATS = OUTPUT_DIR / "regularization_stats.json"


def main() -> None:
    payload = json.loads(INPUT.read_text("utf-8"))
    regularized, stats = regularize_feature_collection(payload)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(regularized, ensure_ascii=False), "utf-8")
    STATS.write_text(json.dumps(stats, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({**stats, "output": str(OUTPUT)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
