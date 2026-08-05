from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.orthographic import PlaneSpec, compose_planes
from rural_house_generator.backend.app.facade.image_io import read_image, write_image


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


def _write(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not write_image(path, image, path.suffix):
        raise OSError(f"failed to write image: {path}")


def run_sample(manifest_path: Path, output_dir: Path) -> dict[str, Path]:
    manifest_path = manifest_path.resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_path = (manifest_path.parent / payload["image"]).resolve()
    if not image_path.is_relative_to(manifest_path.parent):
        raise ValueError("image must stay inside the manifest directory")
    image = read_image(image_path)
    if image is None:
        raise ValueError("manifest image cannot be decoded")

    width, height = [int(value) for value in payload["output_size"]]
    background = tuple(int(value) for value in payload.get("background", [238, 238, 238]))
    image_height, image_width = image.shape[:2]
    planes: list[PlaneSpec] = []
    for index, raw_plane in enumerate(payload.get("planes", [])):
        normalized = np.asarray(raw_plane["source_quad"], dtype=np.float32)
        if normalized.shape != (4, 2) or (normalized < 0).any() or (normalized > 1).any():
            raise ValueError(f"planes[{index}].source_quad must contain four normalized points")
        planes.append(
            PlaneSpec(
                name=str(raw_plane.get("name") or f"plane-{index + 1}"),
                source_quad=normalized * np.float32([image_width - 1, image_height - 1]),
                destination_box=tuple(float(value) for value in raw_plane["destination_box"]),
                feather_px=int(raw_plane.get("feather_px", 0)),
                feather_edges=tuple(
                    str(value)
                    for value in raw_plane.get(
                        "feather_edges", ["top", "right", "bottom", "left"]
                    )
                ),
            )
        )

    atlas = compose_planes(
        image,
        tuple(planes),
        output_size=(width, height),
        background=background,
    )
    overlay = image.copy()
    palette = [(0, 255, 0), (0, 180, 255), (255, 120, 0), (255, 0, 180)]
    for index, plane in enumerate(planes):
        polygon = plane.source_quad.astype(np.int32)
        color = palette[index % len(palette)]
        cv2.polylines(overlay, [polygon], True, color, thickness=7)
        cv2.putText(
            overlay,
            str(index + 1),
            tuple(polygon[0]),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.6,
            color,
            thickness=4,
            lineType=cv2.LINE_AA,
        )
    comparison = np.hstack((_fit_to_canvas(image, width, height), atlas))

    paths = {
        "overlay": output_dir / "01-source-planes.png",
        "orthographic": output_dir / "02-orthographic-atlas.png",
        "comparison": output_dir / "comparison.jpg",
    }
    _write(paths["overlay"], overlay)
    _write(paths["orthographic"], atlas)
    _write(paths["comparison"], comparison)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Render manual 2.5D facade planes")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for name, path in run_sample(args.manifest, args.output_dir).items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
