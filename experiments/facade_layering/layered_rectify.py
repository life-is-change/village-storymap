from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from rural_house_generator.backend.app.facade.perspective import (
    InvalidCornersError,
    order_corners,
)


class InvalidLayerError(ValueError):
    pass


@dataclass(frozen=True)
class LayerSpec:
    source_quad: NDArray[np.floating]
    destination_box: tuple[float, float, float, float]
    feather_px: int = 0


def _validate_image(image: NDArray[np.uint8], name: str) -> None:
    if image.ndim != 3 or image.shape[2] != 3 or image.shape[0] < 2 or image.shape[1] < 2:
        raise ValueError(f"{name} must be a BGR image with at least two pixels per dimension")


def rectify_base(
    image: NDArray[np.uint8],
    source_quad: NDArray[np.floating],
    output_size: tuple[int, int],
) -> tuple[NDArray[np.uint8], NDArray[np.float64]]:
    _validate_image(image, "image")
    output_width, output_height = output_size
    if output_width < 2 or output_height < 2:
        raise ValueError("output size must contain at least two pixels per dimension")

    ordered = order_corners(source_quad)
    destination = np.float32(
        [
            [0, 0],
            [output_width - 1, 0],
            [output_width - 1, output_height - 1],
            [0, output_height - 1],
        ]
    )
    transform = cv2.getPerspectiveTransform(ordered, destination)
    rectified = cv2.warpPerspective(
        image,
        transform,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rectified, transform


def _destination_pixels(
    destination_box: tuple[float, float, float, float],
    canvas_width: int,
    canvas_height: int,
) -> tuple[int, int, int, int]:
    values = np.asarray(destination_box, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all():
        raise InvalidLayerError("destination box must contain four finite values")
    left, top, right, bottom = values.tolist()
    if left < 0 or top < 0 or right > 1 or bottom > 1 or left >= right or top >= bottom:
        raise InvalidLayerError("destination box must be ordered within normalized image bounds")

    x0 = int(round(left * canvas_width))
    y0 = int(round(top * canvas_height))
    x1 = int(round(right * canvas_width))
    y1 = int(round(bottom * canvas_height))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise InvalidLayerError("destination box must cover at least two pixels per dimension")
    return x0, y0, x1, y1


def composite_planar_layer(
    canvas: NDArray[np.uint8],
    source: NDArray[np.uint8],
    spec: LayerSpec,
) -> tuple[NDArray[np.uint8], NDArray[np.uint8]]:
    _validate_image(canvas, "canvas")
    _validate_image(source, "source")
    if spec.feather_px < 0:
        raise InvalidLayerError("feather pixels must not be negative")

    try:
        source_quad = order_corners(spec.source_quad)
    except InvalidCornersError as exc:
        raise InvalidLayerError(str(exc)) from exc

    canvas_height, canvas_width = canvas.shape[:2]
    x0, y0, x1, y1 = _destination_pixels(
        spec.destination_box, canvas_width, canvas_height
    )
    layer_width = x1 - x0
    layer_height = y1 - y0
    layer_destination = np.float32(
        [
            [0, 0],
            [layer_width - 1, 0],
            [layer_width - 1, layer_height - 1],
            [0, layer_height - 1],
        ]
    )
    transform = cv2.getPerspectiveTransform(source_quad, layer_destination)
    rectified_layer = cv2.warpPerspective(
        source,
        transform,
        (layer_width, layer_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )

    overlay = np.zeros_like(canvas)
    overlay[y0:y1, x0:x1] = rectified_layer
    mask = np.zeros((canvas_height, canvas_width), dtype=np.uint8)
    mask[y0:y1, x0:x1] = 255
    if spec.feather_px:
        kernel_size = spec.feather_px * 2 + 1
        mask = cv2.GaussianBlur(mask, (kernel_size, kernel_size), sigmaX=0)

    alpha = mask.astype(np.float32)[:, :, None] / 255.0
    result = np.clip(
        canvas.astype(np.float32) * (1.0 - alpha) + overlay.astype(np.float32) * alpha,
        0,
        255,
    ).astype(np.uint8)
    return result, mask
