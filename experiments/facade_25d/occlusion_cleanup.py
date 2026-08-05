from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np
from numpy.typing import NDArray


def _normalized_polygons(
    polygons: Sequence[NDArray[np.floating]], name: str
) -> tuple[NDArray[np.float64], ...]:
    parsed = tuple(np.asarray(polygon, dtype=np.float64) for polygon in polygons)
    for polygon in parsed:
        if (
            polygon.ndim != 2
            or polygon.shape[0] < 3
            or polygon.shape[1] != 2
            or not np.isfinite(polygon).all()
            or (polygon < 0).any()
            or (polygon > 1).any()
        ):
            raise ValueError(f"{name} must contain normalized N by 2 polygons")
    return parsed


def build_cleanup_mask(
    image_shape: tuple[int, int],
    occlusion_polygons: Sequence[NDArray[np.floating]],
    protected_polygons: Sequence[NDArray[np.floating]] = (),
    dilation_px: int = 0,
) -> NDArray[np.uint8]:
    height, width = (int(image_shape[0]), int(image_shape[1]))
    if height < 2 or width < 2:
        raise ValueError("image_shape must be at least 2 by 2")
    if dilation_px < 0:
        raise ValueError("dilation_px must be non-negative")
    occlusions = _normalized_polygons(occlusion_polygons, "occlusion_polygons")
    protected = _normalized_polygons(protected_polygons, "protected_polygons")
    scale = np.float64([width - 1, height - 1])
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in occlusions:
        cv2.fillPoly(mask, [np.rint(polygon * scale).astype(np.int32)], 255, cv2.LINE_8)
    if dilation_px:
        kernel_size = dilation_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
        mask = cv2.dilate(mask, kernel)
    for polygon in protected:
        cv2.fillPoly(mask, [np.rint(polygon * scale).astype(np.int32)], 0, cv2.LINE_8)
    return mask


def composite_inpainted_candidate(
    faithful: NDArray[np.uint8],
    inpainted: NDArray[np.uint8],
    mask: NDArray[np.uint8],
) -> NDArray[np.uint8]:
    source = np.asarray(faithful)
    generated = np.asarray(inpainted)
    selection = np.asarray(mask) > 0
    if source.ndim != 3 or source.shape[2] not in (3, 4):
        raise ValueError("faithful must be a BGR or BGRA image")
    if generated.ndim != 3 or generated.shape[2] not in (3, 4):
        raise ValueError("inpainted must be a BGR or BGRA image")
    if source.shape[:2] != generated.shape[:2] or selection.shape != source.shape[:2]:
        raise ValueError("faithful, inpainted and mask dimensions must match")
    result = source.copy()
    result[selection, :3] = generated[selection, :3]
    return result
