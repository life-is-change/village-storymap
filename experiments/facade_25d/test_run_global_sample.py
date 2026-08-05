from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.run_global_sample import run_global_sample


def test_run_global_sample_writes_rectified_wall_and_diagnostics(tmp_path: Path):
    source = np.float32([[0, 0], [400, 0], [400, 300], [0, 300]])
    projected = np.float32([[70, 40], [460, 80], [420, 360], [30, 310]])
    perspective = cv2.getPerspectiveTransform(source, projected)
    rectified = np.full((301, 401, 3), 245, dtype=np.uint8)
    for x in (50, 200, 350):
        cv2.line(rectified, (x, 0), (x, 300), (20, 80, 200), 3)
    for y in (40, 150, 260):
        cv2.line(rectified, (0, y), (400, y), (20, 80, 200), 3)
    image = cv2.warpPerspective(rectified, perspective, (500, 400), borderValue=(238, 238, 238))
    assert cv2.imwrite(str(tmp_path / "input.png"), image)

    def project(lines: list[list[list[float]]]) -> list[list[list[float]]]:
        values = cv2.perspectiveTransform(np.float32(lines), perspective)
        values /= np.float32([499, 399])
        return values.tolist()

    crop = cv2.perspectiveTransform(np.float32([source]), perspective)[0]
    crop /= np.float32([499, 399])
    manifest = {
        "image": "input.png",
        "output_width": 420,
        "padding": 10,
        "background": [238, 238, 238],
        "main_wall": {
            "crop_polygon": crop.tolist(),
            "horizontal_lines": project(
                [[[0, 40], [400, 40]], [[0, 150], [400, 150]], [[0, 260], [400, 260]]]
            ),
            "vertical_lines": project(
                [[[50, 0], [50, 300]], [[200, 0], [200, 300]], [[350, 0], [350, 300]]]
            ),
        },
    }
    manifest_path = tmp_path / "global-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_global_sample(manifest_path, tmp_path / "output")

    assert set(paths) == {"source_lines", "global_wall", "final_atlas", "comparison", "diagnostics"}
    assert all(path.is_file() for path in paths.values())
    for key in ("source_lines", "global_wall", "final_atlas", "comparison"):
        assert cv2.imread(str(paths[key])) is not None
    diagnostics = json.loads(paths["diagnostics"].read_text(encoding="utf-8"))
    assert diagnostics["max_horizontal_residual_px"] < 1e-3
    assert diagnostics["max_vertical_residual_px"] < 1e-3
