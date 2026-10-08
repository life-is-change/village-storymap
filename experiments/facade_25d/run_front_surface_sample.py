from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.constrained_mesh import (
    count_folded_triangles,
    map_points_with_mesh,
    rectify_with_constrained_mesh,
)
from experiments.facade_25d.front_surface_atlas import mask_front_surface_canvas
from experiments.facade_25d.global_rectification import transform_points
from experiments.facade_25d.run_constrained_mesh import (
    _fit_to_canvas,
    _normalized_array,
    _normalized_breaks,
    _parse_groups,
    _serialize,
    _write_image,
)
from rural_house_generator.backend.app.facade.image_io import read_image


def run_front_surface_sample(manifest_path: Path, output_dir: Path) -> dict[str, Path]:
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
        wall["horizontal_lines"], (2, 2), "main_wall.horizontal_lines", minimum_count=2
    ) * scale
    vertical = _normalized_array(
        wall["vertical_lines"], (2, 2), "main_wall.vertical_lines", minimum_count=2
    ) * scale

    mesh = payload["mesh"]
    columns = _normalized_breaks(mesh["columns"], "mesh.columns")
    rows = _normalized_breaks(mesh["rows"], "mesh.rows")
    axis_groups = _parse_groups(mesh.get("axis_groups", []), "mesh.axis_groups", scale)
    level_groups = _parse_groups(mesh.get("level_groups", []), "mesh.level_groups", scale)
    max_displacement = np.asarray(mesh.get("max_displacement_px", [5, 5]), dtype=np.float64)
    if max_displacement.shape != (2,) or (max_displacement <= 0).any():
        raise ValueError("mesh.max_displacement_px must contain two positive values")
    weights = mesh.get("weights")
    if weights is not None and not isinstance(weights, dict):
        raise ValueError("mesh.weights must be an object")

    raw_surfaces = payload.get("front_surfaces")
    if not isinstance(raw_surfaces, list) or not raw_surfaces:
        raise ValueError("front_surfaces must contain at least one surface")
    surface_names: list[str] = []
    normalized_surfaces: list[object] = []
    for index, surface in enumerate(raw_surfaces):
        if not isinstance(surface, dict):
            raise ValueError(f"front_surfaces[{index}] must be an object")
        surface_names.append(str(surface.get("name") or f"surface-{index + 1}"))
        normalized_surfaces.append(surface.get("polygon"))
    surface_pixels = _normalized_array(
        normalized_surfaces, (4, 2), "front_surfaces"
    ) * scale

    background = tuple(int(value) for value in payload.get("background", [238, 238, 238]))
    result = rectify_with_constrained_mesh(
        image,
        crop,
        horizontal,
        vertical,
        columns,
        rows,
        output_width=int(payload["output_width"]),
        padding=0,
        axis_groups=tuple(points for _, points in axis_groups),
        level_groups=tuple(points for _, points in level_groups),
        max_displacement=tuple(max_displacement.tolist()),
        weights=weights,
        background=background,
        canvas_mode="union",
    )
    displacement = result.optimized_vertices - result.base_vertices
    mapped_surfaces = []
    for polygon in surface_pixels:
        globally_mapped = transform_points(polygon, result.global_transform)
        mapped_surfaces.append(
            map_points_with_mesh(globally_mapped, result.base_vertices, displacement)
        )
    final_padding = int(payload.get("padding", 0))
    atlas = mask_front_surface_canvas(
        result.image,
        tuple(mapped_surfaces),
        padding=final_padding,
        background=background,
    )

    source_controls = image.copy()
    line_width = max(2, image_width // 900)
    palette = ((20, 220, 30), (255, 170, 20), (20, 150, 255), (210, 80, 210))
    for index, polygon in enumerate(surface_pixels):
        cv2.polylines(
            source_controls,
            [np.rint(polygon).astype(np.int32)],
            True,
            palette[index % len(palette)],
            line_width,
            cv2.LINE_AA,
        )
    for lines, color in ((horizontal, (0, 220, 255)), (vertical, (255, 0, 190))):
        for segment in lines:
            cv2.line(
                source_controls,
                tuple(np.rint(segment[0]).astype(int)),
                tuple(np.rint(segment[1]).astype(int)),
                color,
                line_width,
                cv2.LINE_AA,
            )

    comparison = np.hstack(
        (
            _fit_to_canvas(image, atlas.preview.shape[1], atlas.preview.shape[0]),
            atlas.preview,
        )
    )
    paths = {
        "source_controls": output_dir / "01-source-controls.png",
        "faithful_rgba": output_dir / "02-faithful-atlas.png",
        "faithful_preview": output_dir / "03-faithful-preview.png",
        "front_mask": output_dir / "04-front-mask.png",
        "comparison": output_dir / "comparison.jpg",
        "diagnostics": output_dir / "diagnostics.json",
    }
    _write_image(paths["source_controls"], source_controls)
    _write_image(paths["faithful_rgba"], atlas.rgba)
    _write_image(paths["faithful_preview"], atlas.preview)
    _write_image(paths["front_mask"], atlas.mask)
    _write_image(paths["comparison"], comparison)
    diagnostics = {
        "method": "single_global_h0_plus_structure_preserving_mesh_and_front_masks",
        "canvas_mode": "union",
        "padding": final_padding,
        "resample_passes": result.diagnostics["resample_passes"],
        "folded_triangles": count_folded_triangles(result.optimized_vertices),
        "crop_bounds": atlas.crop_bounds,
        "output_size": [atlas.rgba.shape[1], atlas.rgba.shape[0]],
        "global_transform": result.global_transform,
        "optimizer": result.diagnostics["optimizer"],
        "surfaces": [
            {"name": name, "canvas_polygon": polygon}
            for name, polygon in zip(surface_names, atlas.canvas_polygons, strict=True)
        ],
    }
    paths["diagnostics"].parent.mkdir(parents=True, exist_ok=True)
    paths["diagnostics"].write_text(
        json.dumps(_serialize(diagnostics), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render one tight front-surface atlas with one shared H0"
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for name, path in run_front_surface_sample(args.manifest, args.output_dir).items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
