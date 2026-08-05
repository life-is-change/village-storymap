from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_layering.layered_rectify import rectify_base
from experiments.facade_layering.manifest import load_manifest
from experiments.facade_rebuild.canonicalize import (
    regularize_floor_pixels,
    render_canonical_facade,
)


def _write_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), image):
        raise OSError(f"failed to write image: {path}")


def _fit_to_canvas(image: np.ndarray, width: int, height: int) -> np.ndarray:
    scale = min(width / image.shape[1], height / image.shape[0])
    resized_width = max(1, int(round(image.shape[1] * scale)))
    resized_height = max(1, int(round(image.shape[0] * scale)))
    resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((height, width, 3), 255, dtype=np.uint8)
    x = (width - resized_width) // 2
    y = (height - resized_height) // 2
    canvas[y : y + resized_height, x : x + resized_width] = resized
    return canvas


def run_sample(
    manifest_path: Path,
    output_dir: Path,
    floors: int = 3,
) -> dict[str, Path]:
    raw = cv2.imread(str(manifest_path.parent / "input.jpg"), cv2.IMREAD_COLOR)
    if raw is None:
        raise ValueError("sample image cannot be decoded")
    manifest = load_manifest(manifest_path, raw.shape[:2])
    if manifest.image_path != (manifest_path.parent / "input.jpg").resolve():
        raw = cv2.imread(str(manifest.image_path), cv2.IMREAD_COLOR)
        if raw is None:
            raise ValueError("manifest image cannot be decoded")
        manifest = load_manifest(manifest_path, raw.shape[:2])

    rectified, _ = rectify_base(raw, manifest.base_quad, manifest.output_size)
    regularized = regularize_floor_pixels(rectified, floors=floors)
    canonical = render_canonical_facade(rectified, floors=floors)
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 55, 145)
    edge_preview = cv2.cvtColor(255 - edges, cv2.COLOR_GRAY2BGR)
    comparison = np.hstack((rectified, regularized))

    source_overlay = raw.copy()
    polygon = manifest.base_quad.astype(np.int32)
    cv2.polylines(source_overlay, [polygon], True, (0, 255, 0), thickness=10)
    for index, point in enumerate(polygon, start=1):
        center = tuple(int(value) for value in point)
        cv2.circle(source_overlay, center, 24, (0, 0, 255), thickness=-1)
        cv2.putText(
            source_overlay,
            str(index),
            (center[0] + 28, center[1] - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            2.0,
            (0, 0, 255),
            thickness=5,
            lineType=cv2.LINE_AA,
        )
    fitted_overlay = _fit_to_canvas(
        source_overlay, manifest.output_size[0], manifest.output_size[1]
    )
    four_point_comparison = np.hstack((fitted_overlay, rectified))

    paths = {
        "four_point_overlay": output_dir / "00-source-four-points.png",
        "four_point_comparison": output_dir / "four-point-comparison.jpg",
        "rectified": output_dir / "01-rectified.png",
        "regularized": output_dir / "02-pixel-regularized.png",
        "comparison": output_dir / "pixel-comparison.jpg",
        "control_guide": output_dir / "04-control-guide.png",
        "edges": output_dir / "05-edges.png",
    }
    _write_image(paths["four_point_overlay"], source_overlay)
    _write_image(paths["four_point_comparison"], four_point_comparison)
    _write_image(paths["rectified"], rectified)
    _write_image(paths["regularized"], regularized)
    _write_image(paths["comparison"], comparison)
    _write_image(paths["control_guide"], canonical)
    _write_image(paths["edges"], edge_preview)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the canonical facade prototype")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("experiments/facade_layering/sample_01.json"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("rural_house_generator/runtime_storage/facade_rebuild/sample_01"),
    )
    parser.add_argument("--floors", type=int, default=3)
    args = parser.parse_args()
    for name, path in run_sample(args.manifest, args.output_dir, args.floors).items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
