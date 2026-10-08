from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.run_front_surface_sample import run_front_surface_sample


def test_runner_writes_tight_faithful_atlas_with_one_resample(tmp_path: Path):
    source = np.float32([[0, 0], [320, 0], [320, 240], [0, 240]])
    projected = np.float32([[55, 35], [400, 65], [375, 315], [30, 290]])
    perspective = cv2.getPerspectiveTransform(source, projected)
    facade = np.full((241, 321, 3), 235, dtype=np.uint8)
    for x in (40, 160, 280):
        cv2.line(facade, (x, 0), (x, 240), (30, 70, 180), 3)
    for y in (40, 120, 200):
        cv2.line(facade, (0, y), (320, y), (30, 70, 180), 3)
    image = cv2.warpPerspective(facade, perspective, (440, 350), borderValue=(238, 238, 238))
    assert cv2.imwrite(str(tmp_path / "input.png"), image)
    scale = np.float32([439, 349])

    def normalized(lines):
        return (cv2.perspectiveTransform(np.float32(lines), perspective) / scale).tolist()

    crop = cv2.perspectiveTransform(np.float32([source]), perspective)[0] / scale
    manifest = {
        "image": "input.png",
        "output_width": 420,
        "padding": 0,
        "background": [238, 238, 238],
        "main_wall": {
            "crop_polygon": crop.tolist(),
            "horizontal_lines": normalized(
                [[[0, 40], [320, 40]], [[0, 120], [320, 120]], [[0, 200], [320, 200]]]
            ),
            "vertical_lines": normalized(
                [[[40, 0], [40, 240]], [[160, 0], [160, 240]], [[280, 0], [280, 240]]]
            ),
        },
        "mesh": {
            "columns": [0, 0.25, 0.5, 0.75, 1],
            "rows": [0, 0.25, 0.5, 0.75, 1],
            "max_displacement_px": [5, 5],
            "axis_groups": [],
            "level_groups": [],
        },
        "front_surfaces": [
            {"name": "main", "polygon": crop.tolist()},
        ],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_front_surface_sample(manifest_path, tmp_path / "output")

    assert set(paths) == {
        "source_controls",
        "faithful_rgba",
        "faithful_preview",
        "front_mask",
        "comparison",
        "diagnostics",
    }
    assert all(path.is_file() for path in paths.values())
    rgba = cv2.imread(str(paths["faithful_rgba"]), cv2.IMREAD_UNCHANGED)
    mask = cv2.imread(str(paths["front_mask"]), cv2.IMREAD_GRAYSCALE)
    assert rgba is not None and rgba.shape[2] == 4
    assert mask is not None
    assert np.any(mask[0] == 255)
    assert np.any(mask[-1] == 255)
    assert np.any(mask[:, 0] == 255)
    assert np.any(mask[:, -1] == 255)
    diagnostics = json.loads(paths["diagnostics"].read_text(encoding="utf-8"))
    assert diagnostics["resample_passes"] == 1
    assert diagnostics["canvas_mode"] == "union"
    assert diagnostics["padding"] == 0
    assert diagnostics["folded_triangles"] == 0
