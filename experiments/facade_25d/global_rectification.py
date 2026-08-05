from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from rural_house_generator.backend.app.facade.perspective import order_corners


GEOMETRY_ERROR = "invalid vanishing-point geometry"


@dataclass(frozen=True)
class GlobalWarpResult:
    image: NDArray[np.uint8]
    mask: NDArray[np.uint8]
    transform: NDArray[np.float64]
    diagnostics: dict[str, float | int | list[float]]


def _validated_lines(lines: NDArray[np.floating]) -> NDArray[np.float64]:
    values = np.asarray(lines, dtype=np.float64)
    if values.ndim != 3 or values.shape[1:] != (2, 2) or values.shape[0] < 2:
        raise ValueError(f"{GEOMETRY_ERROR}: at least two line segments are required")
    if not np.isfinite(values).all():
        raise ValueError(f"{GEOMETRY_ERROR}: line coordinates must be finite")
    lengths = np.linalg.norm(values[:, 1] - values[:, 0], axis=1)
    if np.any(lengths <= 1e-8):
        raise ValueError(f"{GEOMETRY_ERROR}: zero-length segment")
    return values


def _homogeneous_lines(lines: NDArray[np.floating]) -> NDArray[np.float64]:
    values = _validated_lines(lines)
    start = np.column_stack((values[:, 0], np.ones(values.shape[0])))
    end = np.column_stack((values[:, 1], np.ones(values.shape[0])))
    coefficients = np.cross(start, end)
    norms = np.linalg.norm(coefficients[:, :2], axis=1)
    if np.any(norms <= 1e-10):
        raise ValueError(f"{GEOMETRY_ERROR}: unstable line coefficients")
    return coefficients / norms[:, np.newaxis]


def fit_vanishing_point(lines: NDArray[np.floating]) -> NDArray[np.float64]:
    coefficients = _homogeneous_lines(lines)
    _, singular_values, vh = np.linalg.svd(coefficients, full_matrices=False)
    if singular_values.size < 2 or singular_values[0] <= 1e-12:
        raise ValueError(f"{GEOMETRY_ERROR}: line fit is rank deficient")
    point = vh[-1]
    if not np.isfinite(point).all() or np.linalg.norm(point) <= 1e-12:
        raise ValueError(f"{GEOMETRY_ERROR}: vanishing point is unstable")
    if abs(point[2]) > 1e-10:
        point = point / point[2]
    else:
        direction_norm = np.linalg.norm(point[:2])
        if direction_norm <= 1e-12:
            raise ValueError(f"{GEOMETRY_ERROR}: vanishing direction is unstable")
        point = point / direction_norm
    return point


def transform_points(
    points: NDArray[np.floating], transform: NDArray[np.floating]
) -> NDArray[np.float64]:
    values = np.asarray(points, dtype=np.float64)
    matrix = np.asarray(transform, dtype=np.float64)
    if values.ndim != 2 or values.shape[1] != 2 or not np.isfinite(values).all():
        raise ValueError("points must be a finite N by 2 array")
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError("transform must be a finite 3 by 3 matrix")
    homogeneous = np.column_stack((values, np.ones(values.shape[0])))
    mapped = (matrix @ homogeneous.T).T
    if np.any(np.abs(mapped[:, 2]) <= 1e-10):
        raise ValueError(f"{GEOMETRY_ERROR}: transformed point lies at infinity")
    return mapped[:, :2] / mapped[:, 2, np.newaxis]


def build_axis_rectification(
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
) -> NDArray[np.float64]:
    horizontal = _validated_lines(horizontal_lines)
    vertical = _validated_lines(vertical_lines)
    horizontal_vp = fit_vanishing_point(horizontal)
    vertical_vp = fit_vanishing_point(vertical)
    vanishing_line = np.cross(horizontal_vp, vertical_vp)
    if not np.isfinite(vanishing_line).all() or np.linalg.norm(vanishing_line[:2]) <= 1e-12:
        raise ValueError(f"{GEOMETRY_ERROR}: vanishing directions coincide")
    if abs(vanishing_line[2]) <= 1e-10:
        raise ValueError(f"{GEOMETRY_ERROR}: vanishing line cannot be normalized")
    vanishing_line = vanishing_line / vanishing_line[2]

    projective = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [vanishing_line[0], vanishing_line[1], 1.0],
        ],
        dtype=np.float64,
    )
    horizontal_direction = (projective @ horizontal_vp)[:2]
    vertical_direction = (projective @ vertical_vp)[:2]
    horizontal_direction /= np.linalg.norm(horizontal_direction)
    vertical_direction /= np.linalg.norm(vertical_direction)
    direction_basis = np.column_stack((horizontal_direction, vertical_direction))
    if abs(np.linalg.det(direction_basis)) <= 1e-8:
        raise ValueError(f"{GEOMETRY_ERROR}: rectified axes are singular")

    affine = np.eye(3, dtype=np.float64)
    affine[:2, :2] = np.linalg.inv(direction_basis)
    transform = affine @ projective

    horizontal_probe = transform_points(horizontal[0], transform)
    vertical_probe = transform_points(vertical[0], transform)
    if horizontal_probe[1, 0] < horizontal_probe[0, 0]:
        transform[0] *= -1.0
    if vertical_probe[1, 1] < vertical_probe[0, 1]:
        transform[1] *= -1.0
    return transform


def _maximum_axis_residual(
    lines: NDArray[np.floating],
    transform: NDArray[np.floating],
    axis: int,
) -> float:
    values = _validated_lines(lines)
    mapped = transform_points(values.reshape(-1, 2), transform).reshape(-1, 2, 2)
    return float(np.max(np.abs(mapped[:, 1, axis] - mapped[:, 0, axis])))


def warp_global_wall(
    image: NDArray[np.uint8],
    crop_polygon: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    output_width: int,
    padding: int = 0,
    background: tuple[int, int, int] = (238, 238, 238),
) -> GlobalWarpResult:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    polygon = np.asarray(crop_polygon, dtype=np.float64)
    if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
        raise ValueError("crop_polygon must be a finite 4 by 2 array")
    if abs(cv2.contourArea(polygon.astype(np.float32))) <= 1e-6:
        raise ValueError("crop_polygon must enclose a non-zero area")
    if output_width < 2 or padding < 0 or output_width <= 2 * padding + 1:
        raise ValueError("output_width must leave room for non-negative padding")

    axis_transform = build_axis_rectification(horizontal_lines, vertical_lines)
    rectified_polygon = transform_points(polygon, axis_transform)
    top_left, top_right, bottom_right, bottom_left = order_corners(
        rectified_polygon.astype(np.float32)
    ).astype(np.float64)
    minimum = np.array(
        [
            max(top_left[0], bottom_left[0]),
            max(top_left[1], top_right[1]),
        ],
        dtype=np.float64,
    )
    maximum = np.array(
        [
            min(top_right[0], bottom_right[0]),
            min(bottom_left[1], bottom_right[1]),
        ],
        dtype=np.float64,
    )
    extent = maximum - minimum
    if not np.isfinite(extent).all() or np.any(extent <= 1e-8):
        raise ValueError(f"{GEOMETRY_ERROR}: transformed crop is degenerate")

    scale = (output_width - 2 * padding) / extent[0]
    output_height = int(np.ceil(extent[1] * scale + 2 * padding))
    if output_height < 2 or output_height > output_width * 8:
        raise ValueError(f"{GEOMETRY_ERROR}: transformed crop is outside bounded output")
    placement = np.array(
        [
            [scale, 0.0, padding - scale * minimum[0]],
            [0.0, scale, padding - scale * minimum[1]],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    transform = placement @ axis_transform

    warped = cv2.warpPerspective(
        image,
        transform,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=background,
    )
    mask = np.zeros((output_height, output_width), dtype=np.uint8)
    mask[padding : output_height - padding, padding : output_width - padding] = 255
    warped[mask == 0] = np.asarray(background, dtype=np.uint8)

    horizontal_vp = fit_vanishing_point(horizontal_lines)
    vertical_vp = fit_vanishing_point(vertical_lines)
    diagnostics: dict[str, float | int | list[float]] = {
        "max_horizontal_residual_px": _maximum_axis_residual(
            horizontal_lines, transform, axis=1
        ),
        "max_vertical_residual_px": _maximum_axis_residual(
            vertical_lines, transform, axis=0
        ),
        "output_width": output_width,
        "output_height": output_height,
        "horizontal_vanishing_point": horizontal_vp.tolist(),
        "vertical_vanishing_point": vertical_vp.tolist(),
    }
    return GlobalWarpResult(
        image=warped,
        mask=mask,
        transform=transform,
        diagnostics=diagnostics,
    )
