from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.run_constrained_mesh import run_constrained_sample


def test_runner_writes_controls_result_grid_comparison_and_parameters(tmp_path: Path):
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

    def normalized(lines: list[list[list[float]]]) -> list[list[list[float]]]:
        return (cv2.perspectiveTransform(np.float32(lines), perspective) / scale).tolist()

    crop = cv2.perspectiveTransform(np.float32([source]), perspective)[0] / scale
    manifest = {
        "image": "input.png",
        "output_width": 420,
        "padding": 10,
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
            "max_displacement_px": [12, 12],
            "axis_groups": [
                {"name": "middle", "points": normalized([[[160, 20], [160, 120]], [[160, 120], [160, 220]]])[0]}
            ],
            "level_groups": [],
        },
    }
    manifest_path = tmp_path / "constrained-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    paths = run_constrained_sample(manifest_path, tmp_path / "output")

    assert set(paths) == {
        "source_controls",
        "rectified_facade",
        "optimized_grid",
        "comparison",
        "parameters",
    }
    assert all(path.is_file() for path in paths.values())
    for key in ("source_controls", "rectified_facade", "optimized_grid", "comparison"):
        assert cv2.imread(str(paths[key])) is not None
    parameters = json.loads(paths["parameters"].read_text(encoding="utf-8"))
    assert np.asarray(parameters["global_transform"]).shape == (3, 3)
    assert parameters["resample_passes"] == 1
    assert parameters["optimizer"]["success"] is True
    assert parameters["optimizer"]["parameterization"] == "separable_rows_columns"
    assert parameters["mesh"]["parameterization"] == "separable_rows_columns"
    assert parameters["mesh"]["folded_triangles"] == 0
    optimized = np.asarray(parameters["mesh"]["optimized_vertices"])
    np.testing.assert_allclose(np.ptp(optimized[:, :, 0], axis=0), 0.0, atol=1e-9)
    np.testing.assert_allclose(np.ptp(optimized[:, :, 1], axis=1), 0.0, atol=1e-9)
