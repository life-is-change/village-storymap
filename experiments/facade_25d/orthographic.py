from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from rural_house_generator.backend.app.facade.perspective import order_corners


@dataclass(frozen=True)
class PlaneSpec:
    name: str
    source_quad: NDArray[np.floating]
    destination_box: tuple[float, float, float, float]
    feather_px: int = 0
    feather_edges: tuple[str, ...] = ("top", "right", "bottom", "left")


def rectify_plane(
    image: NDArray[np.uint8],
    source_quad: NDArray[np.floating],
    output_size: tuple[int, int],
) -> NDArray[np.uint8]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    width, height = output_size
    if width < 2 or height < 2:
        raise ValueError("output_size must be at least 2 by 2")
    source = order_corners(np.asarray(source_quad, dtype=np.float32))
    destination = np.float32(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
    )
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(
        image,
        transform,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _destination_pixels(
    box: tuple[float, float, float, float],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    values = np.asarray(box, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all():
        raise ValueError("destination_box must contain four finite numbers")
    left, top, right, bottom = values.tolist()
    if left < 0 or top < 0 or right > 1 or bottom > 1 or left >= right or top >= bottom:
        raise ValueError("destination_box must be ordered within normalized bounds")
    x0 = int(round(left * width))
    y0 = int(round(top * height))
    x1 = int(round(right * width))
    y1 = int(round(bottom * height))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError("destination_box is too small")
    return x0, y0, x1, y1


def compose_planes(
    image: NDArray[np.uint8],
    planes: tuple[PlaneSpec, ...],
    output_size: tuple[int, int],
    background: tuple[int, int, int] = (238, 238, 238),
) -> NDArray[np.uint8]:
    width, height = output_size
    if width < 2 or height < 2:
        raise ValueError("output_size must be at least 2 by 2")
    canvas = np.empty((height, width, 3), dtype=np.uint8)
    canvas[:] = np.asarray(background, dtype=np.uint8)
    for plane in planes:
        x0, y0, x1, y1 = _destination_pixels(
            plane.destination_box, width, height
        )
        feather_px = int(plane.feather_px)
        if feather_px < 0:
            raise ValueError("feather_px must be non-negative")
        rectified = rectify_plane(
            image,
            plane.source_quad,
            (x1 - x0, y1 - y0),
        )
        if feather_px == 0:
            canvas[y0:y1, x0:x1] = rectified
            continue

        valid_edges = {"top", "right", "bottom", "left"}
        feather_edges = tuple(plane.feather_edges)
        if not feather_edges or not set(feather_edges).issubset(valid_edges):
            raise ValueError("feather_edges must contain valid edge names")
        patch_height, patch_width = rectified.shape[:2]
        yy, xx = np.ogrid[:patch_height, :patch_width]
        distances = {
            "top": yy,
            "right": patch_width - 1 - xx,
            "bottom": patch_height - 1 - yy,
            "left": xx,
        }
        alpha = np.ones((patch_height, patch_width), dtype=np.float32)
        for edge in feather_edges:
            edge_alpha = np.clip(
                (distances[edge].astype(np.float32) + 1.0) / (feather_px + 1.0),
                0.0,
                1.0,
            )
            alpha = np.minimum(alpha, edge_alpha)
        alpha = alpha[..., np.newaxis]
        destination = canvas[y0:y1, x0:x1].astype(np.float32)
        blended = rectified.astype(np.float32) * alpha + destination * (1.0 - alpha)
        canvas[y0:y1, x0:x1] = np.rint(blended).astype(np.uint8)
    return canvas
