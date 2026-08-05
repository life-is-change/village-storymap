from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.global_rectification import warp_global_wall
from rural_house_generator.backend.app.facade.image_io import read_image, write_image


def _normalized_geometry(
    raw: object,
    expected_tail: tuple[int, ...],
    name: str,
    minimum_count: int | None = None,
) -> np.ndarray:
    values = np.asarray(raw, dtype=np.float32)
    if values.ndim != len(expected_tail) + 1 or tuple(values.shape[1:]) != expected_tail:
        raise ValueError(f"{name} has an invalid shape")
    if minimum_count is not None and values.shape[0] < minimum_count:
        raise ValueError(f"{name} requires at least {minimum_count} entries")
    if not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
        raise ValueError(f"{name} must contain finite normalized coordinates")
    return values


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


def run_global_sample(manifest_path: Path, output_dir: Path) -> dict[str, Path]:
    manifest_path = manifest_path.resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_path = (manifest_path.parent / payload["image"]).resolve()
    if not image_path.is_relative_to(manifest_path.parent):
        raise ValueError("image must stay inside the manifest directory")
    image = read_image(image_path)
    if image is None:
        raise ValueError("manifest image cannot be decoded")

    wall = payload["main_wall"]
    crop = _normalized_geometry(
        [wall["crop_polygon"]], (4, 2), "main_wall.crop_polygon"
    )[0]
    horizontal = _normalized_geometry(
        wall["horizontal_lines"],
        (2, 2),
        "main_wall.horizontal_lines",
        minimum_count=2,
    )
    vertical = _normalized_geometry(
        wall["vertical_lines"],
        (2, 2),
        "main_wall.vertical_lines",
        minimum_count=2,
    )
    height, width = image.shape[:2]
    scale = np.float32([width - 1, height - 1])
    crop_pixels = crop * scale
    horizontal_pixels = horizontal * scale
    vertical_pixels = vertical * scale
    background = tuple(int(value) for value in payload.get("background", [238, 238, 238]))

    result = warp_global_wall(
        image,
        crop_pixels,
        horizontal_pixels,
        vertical_pixels,
        output_width=int(payload["output_width"]),
        padding=int(payload.get("padding", 0)),
        background=background,
    )
    overlay = image.copy()
    cv2.polylines(
        overlay,
        [np.rint(crop_pixels).astype(np.int32)],
        True,
        (0, 255, 0),
        thickness=max(2, width // 800),
        lineType=cv2.LINE_AA,
    )
    for lines, color in (
        (horizontal_pixels, (0, 220, 255)),
        (vertical_pixels, (255, 0, 180)),
    ):
        for segment in lines:
            cv2.line(
                overlay,
                tuple(np.rint(segment[0]).astype(int)),
                tuple(np.rint(segment[1]).astype(int)),
                color,
                thickness=max(2, width // 1000),
                lineType=cv2.LINE_AA,
            )

    final_atlas = result.image.copy()
    comparison = np.hstack(
        (
            _fit_to_canvas(image, result.image.shape[1], result.image.shape[0]),
            result.image,
        )
    )
    paths = {
        "source_lines": output_dir / "01-source-lines.png",
        "global_wall": output_dir / "02-global-wall.png",
        "final_atlas": output_dir / "03-final-atlas.png",
        "comparison": output_dir / "comparison.jpg",
        "diagnostics": output_dir / "diagnostics.json",
    }
    _write_image(paths["source_lines"], overlay)
    _write_image(paths["global_wall"], result.image)
    _write_image(paths["final_atlas"], final_atlas)
    _write_image(paths["comparison"], comparison)
    paths["diagnostics"].parent.mkdir(parents=True, exist_ok=True)
    paths["diagnostics"].write_text(
        json.dumps(result.diagnostics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Render one globally rectified facade wall")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for name, path in run_global_sample(args.manifest, args.output_dir).items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
