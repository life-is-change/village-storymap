from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.run_sample import run_sample


def test_run_sample_writes_overlay_orthographic_atlas_and_comparison(tmp_path: Path):
    image = np.full((300, 240, 3), 235, dtype=np.uint8)
    quad = np.int32([[25, 30], [215, 45], [205, 150], [35, 160]])
    cv2.fillConvexPoly(image, quad, (30, 90, 190))
    assert cv2.imwrite(str(tmp_path / "input.jpg"), image)
    manifest = {
        "image": "input.jpg",
        "output_size": [300, 400],
        "background": [238, 238, 238],
        "planes": [
            {
                "name": "test-plane",
                "source_quad": [[0.104, 0.100], [0.900, 0.150], [0.858, 0.500], [0.146, 0.533]],
                "destination_box": [0.10, 0.10, 0.90, 0.60],
            }
        ],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_sample(manifest_path, tmp_path / "output")

    assert paths == {
        "overlay": tmp_path / "output" / "01-source-planes.png",
        "orthographic": tmp_path / "output" / "02-orthographic-atlas.png",
        "comparison": tmp_path / "output" / "comparison.jpg",
    }
    assert all(path.is_file() and cv2.imread(str(path)) is not None for path in paths.values())


def test_run_sample_reads_and_writes_inside_unicode_path(tmp_path: Path):
    unicode_dir = tmp_path / "中文样例"
    unicode_dir.mkdir()
    image = np.full((120, 100, 3), 210, dtype=np.uint8)
    success, encoded = cv2.imencode(".jpg", image)
    assert success
    encoded.tofile(str(unicode_dir / "照片.jpg"))
    manifest = {
        "image": "照片.jpg",
        "output_size": [100, 120],
        "planes": [
            {
                "name": "all",
                "source_quad": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "destination_box": [0, 0, 1, 1],
            }
        ],
    }
    manifest_path = unicode_dir / "配置.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_sample(manifest_path, unicode_dir / "输出")

    assert all(path.is_file() for path in paths.values())


def test_run_sample_applies_manifest_feather_to_plane_edge(tmp_path: Path):
    image = np.full((80, 80, 3), (20, 80, 200), dtype=np.uint8)
    assert cv2.imwrite(str(tmp_path / "input.png"), image)
    manifest = {
        "image": "input.png",
        "output_size": [100, 100],
        "background": [240, 240, 240],
        "planes": [
            {
                "name": "opening",
                "source_quad": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "destination_box": [0.2, 0.2, 0.8, 0.8],
                "feather_px": 4,
            }
        ],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_sample(manifest_path, tmp_path / "output")
    atlas = cv2.imread(str(paths["orthographic"]))

    assert atlas is not None
    edge = atlas[20, 50]
    assert np.all(edge > np.array([20, 80, 200]))
    assert np.all(edge < np.array([240, 240, 240]))
