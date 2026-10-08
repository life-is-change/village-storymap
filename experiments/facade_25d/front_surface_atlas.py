from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

from experiments.facade_25d.constrained_mesh import tight_crop_rgba
from experiments.facade_25d.global_rectification import transform_points
from rural_house_generator.backend.app.facade.perspective import order_corners


@dataclass(frozen=True)
class FrontSurfaceAtlasResult:
    rgba: NDArray[np.uint8]
    preview: NDArray[np.uint8]
    mask: NDArray[np.uint8]
    crop_bounds: tuple[int, int, int, int]
    canvas_polygons: tuple[NDArray[np.float64], ...]
    resample_passes: int


def _preview_rgba(
    rgba: NDArray[np.uint8], background: tuple[int, int, int]
) -> NDArray[np.uint8]:
    preview = np.full(rgba.shape[:2] + (3,), background, dtype=np.uint8)
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.clip(
        rgba[..., :3].astype(np.float32) * alpha
        + preview.astype(np.float32) * (1.0 - alpha),
        0,
        255,
    ).astype(np.uint8)


def _inverse_perspective_map(
    transform: NDArray[np.floating],
    output_size: tuple[int, int],
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    matrix = np.asarray(transform, dtype=np.float64)
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError("transform must be a finite 3 by 3 matrix")
    width, height = (int(output_size[0]), int(output_size[1]))
    if width < 2 or height < 2:
        raise ValueError("output_size must be at least 2 by 2")
    inverse = np.linalg.inv(matrix)
    yy, xx = np.mgrid[:height, :width]
    destination = np.stack(
        (xx.ravel(), yy.ravel(), np.ones(width * height, dtype=np.float64)), axis=0
    )
    source = inverse @ destination
    denominator = source[2]
    valid = np.abs(denominator) > 1e-10
    map_x = np.full(width * height, -1.0, dtype=np.float32)
    map_y = np.full(width * height, -1.0, dtype=np.float32)
    map_x[valid] = (source[0, valid] / denominator[valid]).astype(np.float32)
    map_y[valid] = (source[1, valid] / denominator[valid]).astype(np.float32)
    return map_x.reshape(height, width), map_y.reshape(height, width)


def _regularized_front_quad(
    polygon: NDArray[np.floating],
    transform: NDArray[np.floating],
    output_size: tuple[int, int],
) -> NDArray[np.float64]:
    values = np.asarray(polygon, dtype=np.float64)
    if values.shape != (4, 2) or not np.isfinite(values).all():
        raise ValueError("each front surface must be a finite 4 by 2 polygon")
    mapped = transform_points(values, transform)
    top_left, top_right, bottom_right, bottom_left = order_corners(
        mapped.astype(np.float32)
    ).astype(np.float64)
    left = float(np.mean((top_left[0], bottom_left[0])))
    right = float(np.mean((top_right[0], bottom_right[0])))
    top = float(np.mean((top_left[1], top_right[1])))
    bottom = float(np.mean((bottom_left[1], bottom_right[1])))
    if left >= right or top >= bottom:
        raise ValueError("front surface becomes degenerate after rectification")
    width, height = output_size
    return np.float64(
        [
            [np.clip(left, 0, width - 1), np.clip(top, 0, height - 1)],
            [np.clip(right, 0, width - 1), np.clip(top, 0, height - 1)],
            [np.clip(right, 0, width - 1), np.clip(bottom, 0, height - 1)],
            [np.clip(left, 0, width - 1), np.clip(bottom, 0, height - 1)],
        ]
    )


def render_front_surface_atlas(
    image: NDArray[np.uint8],
    transform: NDArray[np.floating],
    polygons: Sequence[NDArray[np.floating]],
    output_size: tuple[int, int],
    padding: int = 0,
    background: tuple[int, int, int] = (238, 238, 238),
) -> FrontSurfaceAtlasResult:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    if not polygons:
        raise ValueError("at least one front surface polygon is required")
    width, height = (int(output_size[0]), int(output_size[1]))
    map_x, map_y = _inverse_perspective_map(transform, (width, height))
    warped = cv2.remap(
        image,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=background,
    )

    canvas_polygons = tuple(
        _regularized_front_quad(polygon, transform, (width, height))
        for polygon in polygons
    )
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in canvas_polygons:
        cv2.fillConvexPoly(mask, np.rint(polygon).astype(np.int32), 255, cv2.LINE_8)

    rgba, cropped_mask, crop_bounds = tight_crop_rgba(warped, mask, padding=padding)
    preview = _preview_rgba(rgba, background)
    return FrontSurfaceAtlasResult(
        rgba=rgba,
        preview=preview,
        mask=cropped_mask,
        crop_bounds=crop_bounds,
        canvas_polygons=canvas_polygons,
        resample_passes=1,
    )


def mask_front_surface_canvas(
    image: NDArray[np.uint8],
    polygons: Sequence[NDArray[np.floating]],
    padding: int = 0,
    background: tuple[int, int, int] = (238, 238, 238),
) -> FrontSurfaceAtlasResult:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    if not polygons:
        raise ValueError("at least one front surface polygon is required")
    height, width = image.shape[:2]
    identity = np.eye(3, dtype=np.float64)
    canvas_polygons = tuple(
        _regularized_front_quad(polygon, identity, (width, height))
        for polygon in polygons
    )
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in canvas_polygons:
        cv2.fillConvexPoly(mask, np.rint(polygon).astype(np.int32), 255, cv2.LINE_8)
    rgba, cropped_mask, crop_bounds = tight_crop_rgba(image, mask, padding=padding)
    return FrontSurfaceAtlasResult(
        rgba=rgba,
        preview=_preview_rgba(rgba, background),
        mask=cropped_mask,
        crop_bounds=crop_bounds,
        canvas_polygons=canvas_polygons,
        resample_passes=0,
    )
