from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from experiments.facade_25d.constrained_mesh import (
    count_folded_triangles,
    map_points_with_mesh,
    rectify_with_constrained_mesh,
)
from experiments.facade_25d.global_rectification import transform_points
from rural_house_generator.backend.app.facade.image_io import read_image, write_image


def _normalized_array(
    raw: object,
    tail: tuple[int, ...],
    name: str,
    minimum_count: int | None = None,
) -> np.ndarray:
    values = np.asarray(raw, dtype=np.float64)
    if values.ndim != len(tail) + 1 or tuple(values.shape[1:]) != tail:
        raise ValueError(f"{name} has an invalid shape")
    if minimum_count is not None and values.shape[0] < minimum_count:
        raise ValueError(f"{name} requires at least {minimum_count} entries")
    if not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
        raise ValueError(f"{name} must contain finite normalized coordinates")
    return values


def _normalized_breaks(raw: object, name: str) -> np.ndarray:
    values = np.asarray(raw, dtype=np.float64)
    if values.ndim != 1 or values.size < 3:
        raise ValueError(f"{name} requires at least three entries")
    if not np.isfinite(values).all() or values[0] != 0 or values[-1] != 1:
        raise ValueError(f"{name} must start at 0 and end at 1")
    if np.any(np.diff(values) <= 0):
        raise ValueError(f"{name} must be strictly increasing")
    return values


def _parse_groups(
    raw_groups: object,
    name: str,
    scale: np.ndarray,
) -> tuple[tuple[str, np.ndarray], ...]:
    if raw_groups is None:
        return ()
    if not isinstance(raw_groups, list):
        raise ValueError(f"{name} must be a list")
    parsed: list[tuple[str, np.ndarray]] = []
    for index, raw in enumerate(raw_groups):
        if not isinstance(raw, dict):
            raise ValueError(f"{name}[{index}] must be an object")
        points = _normalized_array(
            raw.get("points"), (2,), f"{name}[{index}].points", minimum_count=2
        )
        parsed.append((str(raw.get("name") or f"{name}-{index + 1}"), points * scale))
    return tuple(parsed)


def _fit_to_canvas(image: np.ndarray, width: int, height: int) -> np.ndarray:
    scale = min(width / image.shape[1], height / image.shape[0])
    resized = cv2.resize(
        image,
        (
            max(1, int(round(image.shape[1] * scale))),
            max(1, int(round(image.shape[0] * scale))),
        ),
        interpolation=cv2.INTER_AREA,
    )
    canvas = np.full((height, width, 3), 255, dtype=np.uint8)
    x = (width - resized.shape[1]) // 2
    y = (height - resized.shape[0]) // 2
    canvas[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
    return canvas


def _write_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not write_image(path, image, path.suffix):
        raise OSError(f"failed to write image: {path}")


def _draw_grid(
    image: np.ndarray,
    vertices: np.ndarray,
    color: tuple[int, int, int],
    thickness: int,
) -> None:
    rounded = np.rint(vertices).astype(np.int32)
    for row in rounded:
        cv2.polylines(image, [row], False, color, thickness, cv2.LINE_AA)
    for column in range(rounded.shape[1]):
        cv2.polylines(
            image,
            [np.ascontiguousarray(rounded[:, column])],
            False,
            color,
            thickness,
            cv2.LINE_AA,
        )


def _serialize(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, dict):
        return {str(key): _serialize(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_serialize(item) for item in value]
    return value


def run_constrained_sample(manifest_path: Path, output_dir: Path) -> dict[str, Path]:
    manifest_path = manifest_path.resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_path = (manifest_path.parent / payload["image"]).resolve()
    if not image_path.is_relative_to(manifest_path.parent):
        raise ValueError("image must stay inside the manifest directory")
    image = read_image(image_path)
    if image is None:
        raise ValueError("manifest image cannot be decoded")
    image_height, image_width = image.shape[:2]
    scale = np.float64([image_width - 1, image_height - 1])

    wall = payload["main_wall"]
    crop = _normalized_array(
        [wall["crop_polygon"]], (4, 2), "main_wall.crop_polygon"
    )[0] * scale
    horizontal = _normalized_array(
        wall["horizontal_lines"],
        (2, 2),
        "main_wall.horizontal_lines",
        minimum_count=2,
    ) * scale
    vertical = _normalized_array(
        wall["vertical_lines"],
        (2, 2),
        "main_wall.vertical_lines",
        minimum_count=2,
    ) * scale

    mesh = payload["mesh"]
    columns = _normalized_breaks(mesh["columns"], "mesh.columns")
    rows = _normalized_breaks(mesh["rows"], "mesh.rows")
    axis_groups = _parse_groups(mesh.get("axis_groups", []), "mesh.axis_groups", scale)
    level_groups = _parse_groups(mesh.get("level_groups", []), "mesh.level_groups", scale)
    max_displacement_raw = np.asarray(
        mesh.get("max_displacement_px", [24, 18]), dtype=np.float64
    )
    if (
        max_displacement_raw.shape != (2,)
        or not np.isfinite(max_displacement_raw).all()
        or (max_displacement_raw <= 0).any()
    ):
        raise ValueError("mesh.max_displacement_px must contain two positive numbers")
    weights = mesh.get("weights")
    if weights is not None and not isinstance(weights, dict):
        raise ValueError("mesh.weights must be an object")
    background = tuple(int(value) for value in payload.get("background", [238, 238, 238]))

    result = rectify_with_constrained_mesh(
        image,
        crop,
        horizontal,
        vertical,
        columns,
        rows,
        output_width=int(payload["output_width"]),
        padding=int(payload.get("padding", 0)),
        axis_groups=tuple(points for _, points in axis_groups),
        level_groups=tuple(points for _, points in level_groups),
        max_displacement=tuple(max_displacement_raw.tolist()),
        weights=weights,
        background=background,
    )

    source_controls = image.copy()
    line_width = max(2, image_width // 900)
    cv2.polylines(
        source_controls,
        [np.rint(crop).astype(np.int32)],
        True,
        (30, 220, 30),
        line_width + 1,
        cv2.LINE_AA,
    )
    for lines, color in (
        (horizontal, (0, 220, 255)),
        (vertical, (255, 0, 190)),
    ):
        for segment in lines:
            cv2.line(
                source_controls,
                tuple(np.rint(segment[0]).astype(int)),
                tuple(np.rint(segment[1]).astype(int)),
                color,
                line_width,
                cv2.LINE_AA,
            )
    group_palette = ((20, 120, 255), (255, 150, 20), (50, 210, 130), (210, 80, 210))
    for group_index, (_, points) in enumerate(axis_groups + level_groups):
        color = group_palette[group_index % len(group_palette)]
        for point in points:
            cv2.circle(
                source_controls,
                tuple(np.rint(point).astype(int)),
                line_width + 5,
                color,
                -1,
                cv2.LINE_AA,
            )

    optimized_grid = result.image.copy()
    _draw_grid(optimized_grid, result.base_vertices, (140, 140, 140), 1)
    _draw_grid(optimized_grid, result.optimized_vertices, (20, 220, 30), 2)
    target_horizontal = transform_points(horizontal.reshape(-1, 2), result.global_transform)
    target_vertical = transform_points(vertical.reshape(-1, 2), result.global_transform)
    corrected_horizontal = map_points_with_mesh(
        target_horizontal, result.base_vertices, result.optimized_vertices - result.base_vertices
    ).reshape(horizontal.shape)
    corrected_vertical = map_points_with_mesh(
        target_vertical, result.base_vertices, result.optimized_vertices - result.base_vertices
    ).reshape(vertical.shape)
    for lines, color in (
        (corrected_horizontal, (0, 220, 255)),
        (corrected_vertical, (255, 0, 190)),
    ):
        for segment in lines:
            cv2.line(
                optimized_grid,
                tuple(np.rint(segment[0]).astype(int)),
                tuple(np.rint(segment[1]).astype(int)),
                color,
                2,
                cv2.LINE_AA,
            )

    width, height = result.diagnostics["output_width"], result.diagnostics["output_height"]
    comparison = np.hstack((_fit_to_canvas(image, int(width), int(height)), result.image))
    paths = {
        "source_controls": output_dir / "01-source-controls.png",
        "rectified_facade": output_dir / "02-rectified-facade.png",
        "optimized_grid": output_dir / "03-optimized-grid.png",
        "comparison": output_dir / "comparison.jpg",
        "parameters": output_dir / "transform-parameters.json",
    }
    _write_image(paths["source_controls"], source_controls)
    _write_image(paths["rectified_facade"], result.image)
    _write_image(paths["optimized_grid"], optimized_grid)
    _write_image(paths["comparison"], comparison)
    parameters = {
        "method": "single_global_h0_plus_structure_preserving_mesh",
        "global_transform": result.global_transform,
        "resample_passes": result.diagnostics["resample_passes"],
        "optimizer": result.diagnostics["optimizer"],
        "mesh": {
            "columns": columns,
            "rows": rows,
            "max_displacement_px": max_displacement_raw,
            "weights": weights or {},
            "parameterization": result.diagnostics["optimizer"]["parameterization"],
            "base_vertices": result.base_vertices,
            "optimized_vertices": result.optimized_vertices,
            "source_vertices": result.source_vertices,
            "folded_triangles": count_folded_triangles(result.optimized_vertices),
        },
        "controls": {
            "axis_groups": [name for name, _ in axis_groups],
            "level_groups": [name for name, _ in level_groups],
            "horizontal_line_count": int(horizontal.shape[0]),
            "vertical_line_count": int(vertical.shape[0]),
        },
        "canvas": {
            "output_width": result.diagnostics["output_width"],
            "output_height": result.diagnostics["output_height"],
            "horizontal_vanishing_point": result.diagnostics[
                "horizontal_vanishing_point"
            ],
            "vertical_vanishing_point": result.diagnostics["vertical_vanishing_point"],
        },
    }
    paths["parameters"].parent.mkdir(parents=True, exist_ok=True)
    paths["parameters"].write_text(
        json.dumps(_serialize(parameters), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rectify one multi-storey facade with one H0 and a constrained mesh"
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for name, path in run_constrained_sample(args.manifest, args.output_dir).items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
