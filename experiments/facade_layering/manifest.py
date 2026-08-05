from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from rural_house_generator.backend.app.facade.perspective import (
    InvalidCornersError,
    order_corners,
)


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class ManifestLayer:
    name: str
    source_quad: NDArray[np.float32]
    destination_box: tuple[float, float, float, float]
    feather_px: int


@dataclass(frozen=True)
class ExperimentManifest:
    path: Path
    image_path: Path
    output_size: tuple[int, int]
    base_quad: NDArray[np.float32]
    layers: tuple[ManifestLayer, ...]
    occlusion_mask_path: Path | None


def _resolve_local_path(manifest_dir: Path, raw_path: Any, field_name: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ManifestError(f"{field_name} must be a non-empty relative path")
    candidate = (manifest_dir / raw_path).resolve()
    if not candidate.is_relative_to(manifest_dir):
        raise ManifestError(f"{field_name} must stay inside the manifest directory")
    return candidate


def _normalized_quad(
    raw_points: Any,
    field_name: str,
    image_shape: tuple[int, int],
) -> NDArray[np.float32]:
    points = np.asarray(raw_points, dtype=np.float32)
    if points.shape != (4, 2):
        raise ManifestError(f"{field_name} must contain exactly four points")
    if not np.isfinite(points).all() or (points < 0).any() or (points > 1).any():
        raise ManifestError(f"{field_name} points must be finite normalized coordinates")
    image_height, image_width = image_shape
    pixels = points * np.float32([image_width - 1, image_height - 1])
    try:
        return order_corners(pixels)
    except InvalidCornersError as exc:
        raise ManifestError(f"{field_name} must form a valid quadrilateral") from exc


def _destination_box(raw_box: Any, field_name: str) -> tuple[float, float, float, float]:
    values = np.asarray(raw_box, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all():
        raise ManifestError(f"{field_name} must contain four finite values")
    left, top, right, bottom = values.tolist()
    if left < 0 or top < 0 or right > 1 or bottom > 1 or left >= right or top >= bottom:
        raise ManifestError(f"{field_name} must be ordered within normalized image bounds")
    return left, top, right, bottom


def load_manifest(
    path: Path,
    image_shape: tuple[int, int],
) -> ExperimentManifest:
    manifest_path = path.resolve()
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"Cannot read experiment manifest: {exc}") from exc
    if not isinstance(payload, dict):
        raise ManifestError("Manifest root must be a JSON object")

    manifest_dir = manifest_path.parent
    image_path = _resolve_local_path(manifest_dir, payload.get("image"), "image")
    if not image_path.is_file():
        raise ManifestError("image file does not exist")

    output_size_raw = payload.get("output_size")
    if (
        not isinstance(output_size_raw, list)
        or len(output_size_raw) != 2
        or any(isinstance(item, bool) or not isinstance(item, int) for item in output_size_raw)
    ):
        raise ManifestError("output_size must contain integer width and height")
    output_size = tuple(output_size_raw)
    if output_size[0] < 2 or output_size[1] < 2 or output_size[0] > 8192 or output_size[1] > 8192:
        raise ManifestError("output_size must be between 2 and 8192 pixels")

    base_quad = _normalized_quad(payload.get("base_quad"), "base_quad", image_shape)
    raw_layers = payload.get("layers", [])
    if not isinstance(raw_layers, list):
        raise ManifestError("layers must be a list")
    layers: list[ManifestLayer] = []
    for index, raw_layer in enumerate(raw_layers):
        if not isinstance(raw_layer, dict):
            raise ManifestError(f"layers[{index}] must be an object")
        name = str(raw_layer.get("name") or f"layer-{index + 1:02d}")
        feather_px = raw_layer.get("feather_px", 0)
        if isinstance(feather_px, bool) or not isinstance(feather_px, int) or feather_px < 0 or feather_px > 128:
            raise ManifestError(f"layers[{index}].feather_px must be an integer from 0 to 128")
        layers.append(
            ManifestLayer(
                name=name,
                source_quad=_normalized_quad(
                    raw_layer.get("source_quad"),
                    f"layers[{index}].source_quad",
                    image_shape,
                ),
                destination_box=_destination_box(
                    raw_layer.get("destination_box"),
                    f"layers[{index}].destination_box",
                ),
                feather_px=feather_px,
            )
        )

    raw_mask = payload.get("occlusion_mask")
    occlusion_mask_path = None
    if raw_mask is not None:
        occlusion_mask_path = _resolve_local_path(
            manifest_dir, raw_mask, "occlusion_mask"
        )
        if not occlusion_mask_path.is_file():
            raise ManifestError("occlusion_mask file does not exist")

    return ExperimentManifest(
        path=manifest_path,
        image_path=image_path,
        output_size=(output_size[0], output_size[1]),
        base_quad=base_quad,
        layers=tuple(layers),
        occlusion_mask_path=occlusion_mask_path,
    )
