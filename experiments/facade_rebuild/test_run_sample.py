from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_rebuild.run_sample import run_sample


def test_run_sample_writes_pixel_preserving_preview_and_diagnostics(tmp_path: Path):
    image = np.full((300, 240, 3), 225, dtype=np.uint8)
    cv2.rectangle(image, (55, 95), (100, 210), (45, 45, 45), -1)
    cv2.rectangle(image, (135, 110), (195, 210), (55, 55, 55), -1)
    assert cv2.imwrite(str(tmp_path / "input.jpg"), image)
    manifest = {
        "image": "input.jpg",
        "output_size": [240, 300],
        "base_quad": [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]],
        "layers": [],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_sample(manifest_path, tmp_path / "output", floors=3)

    assert paths == {
        "four_point_overlay": tmp_path / "output" / "00-source-four-points.png",
        "four_point_comparison": tmp_path / "output" / "four-point-comparison.jpg",
        "rectified": tmp_path / "output" / "01-rectified.png",
        "regularized": tmp_path / "output" / "02-pixel-regularized.png",
        "comparison": tmp_path / "output" / "pixel-comparison.jpg",
        "control_guide": tmp_path / "output" / "04-control-guide.png",
        "edges": tmp_path / "output" / "05-edges.png",
    }
    assert all(path.is_file() and cv2.imread(str(path)) is not None for path in paths.values())
