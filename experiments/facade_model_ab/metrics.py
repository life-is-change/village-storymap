from __future__ import annotations

import numpy as np


def _rounded(value: float) -> float:
    return round(float(value), 6)


def _residual_summary(lines: np.ndarray, axis: str) -> dict[str, float | None]:
    lines = np.asarray(lines, dtype=np.float64)
    if lines.size == 0:
        return {"median": None, "p95": None}
    delta = lines[:, 1] - lines[:, 0]
    angles = np.abs(np.degrees(np.arctan2(delta[:, 1], delta[:, 0]))) % 180.0
    if axis == "horizontal":
        residual = np.minimum(angles, 180.0 - angles)
    elif axis == "vertical":
        residual = np.abs(90.0 - angles)
    else:
        raise ValueError(f"unknown axis: {axis}")
    return {
        "median": _rounded(np.median(residual)),
        "p95": _rounded(np.percentile(residual, 95)),
    }


def measure_variant(
    horizontal_lines: np.ndarray,
    vertical_lines: np.ndarray,
    *,
    source_facade_mask: np.ndarray | None = None,
    retained_facade_mask: np.ndarray | None = None,
    crop_shape: tuple[int, int],
    nonzero_crop_pixels: int,
    folded_triangles: int,
    remap_passes: int,
) -> dict[str, object]:
    if folded_triangles:
        raise ValueError("folded mesh is not a valid facade result")
    height, width = crop_shape
    if height <= 0 or width <= 0:
        raise ValueError("crop shape must be positive")
    crop_pixels = height * width
    if nonzero_crop_pixels < 0 or nonzero_crop_pixels > crop_pixels:
        raise ValueError("nonzero crop pixels fall outside crop bounds")

    coverage: float | None = None
    if source_facade_mask is not None and retained_facade_mask is not None:
        source_pixels = int(np.count_nonzero(source_facade_mask))
        retained_pixels = int(np.count_nonzero(retained_facade_mask))
        coverage = 0.0 if source_pixels == 0 else retained_pixels / source_pixels

    return {
        "horizontal_residual_deg": _residual_summary(horizontal_lines, "horizontal"),
        "vertical_residual_deg": _residual_summary(vertical_lines, "vertical"),
        "facade_coverage": None if coverage is None else float(coverage),
        "crop_occupancy": float(nonzero_crop_pixels / crop_pixels),
        "folded_triangles": int(folded_triangles),
        "remap_passes": int(remap_passes),
    }
