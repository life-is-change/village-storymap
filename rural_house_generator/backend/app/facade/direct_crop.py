from __future__ import annotations

import cv2
import numpy as np


def _content_columns(image: np.ndarray, background: np.ndarray) -> np.ndarray:
    difference = np.linalg.norm(
        image.astype(np.int16) - background.astype(np.int16), axis=2
    )
    minimum_evidence = max(2, round(image.shape[0] * 0.005))
    columns = np.flatnonzero((difference > 10).sum(axis=0) >= minimum_evidence)
    if columns.size and columns[-1] - columns[0] >= image.shape[1] * 0.15:
        return columns

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 24, 72)
    return np.flatnonzero((edges > 0).sum(axis=0) >= minimum_evidence)


def _mask_columns(mask: np.ndarray) -> np.ndarray:
    minimum_evidence = max(2, round(mask.shape[0] * 0.01))
    return np.flatnonzero((mask > 0).sum(axis=0) >= minimum_evidence)


def crop_facade_body(
    image: np.ndarray,
    crop_top: float,
    content_mask: np.ndarray | None = None,
) -> np.ndarray:
    if image.ndim != 3 or image.shape[2] not in (3, 4):
        raise ValueError("Facade image must have three or four color channels")
    if not np.isfinite(crop_top) or not 0 <= crop_top <= 0.65:
        raise ValueError("crop_top must be between 0 and 0.65")

    top = min(image.shape[0] - 1, round(image.shape[0] * crop_top))
    body = np.ascontiguousarray(image[top:])
    columns = np.empty(0, dtype=np.int64)
    if content_mask is not None:
        values = np.asarray(content_mask)
        if values.ndim == 3:
            values = values[..., 0]
        if values.shape == image.shape[:2]:
            columns = _mask_columns(values[top:])

    if columns.size and columns[-1] - columns[0] >= body.shape[1] * 0.15:
        padding = max(2, round(body.shape[1] * 0.01))
        left = max(0, int(columns[0]) - padding)
        right = min(body.shape[1], int(columns[-1]) + 1 + padding)
        return np.ascontiguousarray(body[:, left:right])

    sample_size = max(2, min(body.shape[:2]) // 20)
    corner_samples = np.concatenate(
        (
            body[:sample_size, :sample_size].reshape(-1, body.shape[2]),
            body[:sample_size, -sample_size:].reshape(-1, body.shape[2]),
            body[-sample_size:, :sample_size].reshape(-1, body.shape[2]),
            body[-sample_size:, -sample_size:].reshape(-1, body.shape[2]),
        )
    )
    background = np.median(corner_samples, axis=0)
    columns = _content_columns(body, background)
    if not columns.size or columns[-1] - columns[0] < body.shape[1] * 0.15:
        return body.copy()

    padding = max(2, round(body.shape[1] * 0.01))
    left = max(0, int(columns[0]) - padding)
    right = min(body.shape[1], int(columns[-1]) + 1 + padding)
    return np.ascontiguousarray(body[:, left:right])
