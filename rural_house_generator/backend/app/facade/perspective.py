from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray


class InvalidCornersError(ValueError):
    pass


def order_corners(points: NDArray[np.floating]) -> NDArray[np.float32]:
    corners = np.asarray(points, dtype=np.float32)
    if corners.shape != (4, 2) or not np.isfinite(corners).all():
        raise InvalidCornersError("Corners must form a valid quadrilateral")

    ordered = np.empty((4, 2), dtype=np.float32)
    coordinate_sums = corners.sum(axis=1)
    coordinate_differences = np.diff(corners, axis=1).reshape(-1)
    ordered[0] = corners[np.argmin(coordinate_sums)]
    ordered[2] = corners[np.argmax(coordinate_sums)]
    ordered[1] = corners[np.argmin(coordinate_differences)]
    ordered[3] = corners[np.argmax(coordinate_differences)]

    if len(np.unique(ordered, axis=0)) != 4:
        raise InvalidCornersError("Corners must form a valid quadrilateral")
    if cv2.contourArea(ordered) < 4.0:
        raise InvalidCornersError("Corners must form a valid quadrilateral")
    if not cv2.isContourConvex(ordered.astype(np.int32)):
        raise InvalidCornersError("Corners must form a valid quadrilateral")
    return ordered


def normalized_to_pixels(
    points: NDArray[np.floating], image_width: int, image_height: int
) -> NDArray[np.float32]:
    normalized = np.asarray(points, dtype=np.float32)
    if normalized.shape != (4, 2) or not np.isfinite(normalized).all():
        raise InvalidCornersError("Corners must form a valid quadrilateral")
    if (normalized < 0).any() or (normalized > 1).any():
        raise InvalidCornersError("Normalized corners must be between 0 and 1")
    scale = np.float32([image_width - 1, image_height - 1])
    return normalized * scale


def rectify_facade(
    image: NDArray[np.uint8], points: NDArray[np.floating]
) -> NDArray[np.uint8]:
    if image.ndim not in (2, 3) or image.shape[0] < 2 or image.shape[1] < 2:
        raise ValueError("Image must contain at least two pixels per dimension")

    top_left, top_right, bottom_right, bottom_left = order_corners(points)
    output_width = int(
        round(
            max(
                np.linalg.norm(top_right - top_left),
                np.linalg.norm(bottom_right - bottom_left),
            )
        )
    )
    output_height = int(
        round(
            max(
                np.linalg.norm(bottom_left - top_left),
                np.linalg.norm(bottom_right - top_right),
            )
        )
    )
    if output_width < 2 or output_height < 2:
        raise InvalidCornersError("Corners must form a valid quadrilateral")

    destination = np.float32(
        [
            [0, 0],
            [output_width - 1, 0],
            [output_width - 1, output_height - 1],
            [0, output_height - 1],
        ]
    )
    transform = cv2.getPerspectiveTransform(
        np.float32([top_left, top_right, bottom_right, bottom_left]), destination
    )
    return cv2.warpPerspective(
        image,
        transform,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
