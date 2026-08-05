from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

import cv2
import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares

from experiments.facade_25d.global_rectification import (
    build_axis_rectification,
    fit_vanishing_point,
    transform_points,
)
from rural_house_generator.backend.app.facade.perspective import order_corners


GEOMETRY_ERROR = "invalid constrained-mesh geometry"

DEFAULT_WEIGHTS: dict[str, float] = {
    "horizontal": 4.0,
    "vertical": 4.0,
    "axis": 5.0,
    "level": 5.0,
    "boundary": 20.0,
    "scale": 0.30,
    "smoothness": 0.45,
    "magnitude": 0.06,
}


@dataclass(frozen=True)
class GlobalCanvasGeometry:
    transform: NDArray[np.float64]
    output_size: tuple[int, int]
    inner_bounds: tuple[float, float, float, float]
    horizontal_vanishing_point: NDArray[np.float64]
    vertical_vanishing_point: NDArray[np.float64]


@dataclass(frozen=True)
class MeshOptimizationResult:
    displacements: NDArray[np.float64]
    optimized_vertices: NDArray[np.float64]
    diagnostics: dict[str, float | int | bool | str]


@dataclass(frozen=True)
class ConstrainedRectificationResult:
    image: NDArray[np.uint8]
    map_x: NDArray[np.float32]
    map_y: NDArray[np.float32]
    global_transform: NDArray[np.float64]
    base_vertices: NDArray[np.float64]
    optimized_vertices: NDArray[np.float64]
    source_vertices: NDArray[np.float64]
    diagnostics: dict[str, object]


def _validated_breaks(values: NDArray[np.floating], name: str) -> NDArray[np.float64]:
    breaks = np.asarray(values, dtype=np.float64)
    if breaks.ndim != 1 or breaks.size < 3:
        raise ValueError(f"{name} must contain at least three entries")
    if not np.isfinite(breaks).all() or breaks[0] != 0.0 or breaks[-1] != 1.0:
        raise ValueError(f"{name} must start at 0 and end at 1")
    if np.any(np.diff(breaks) <= 0):
        raise ValueError(f"{name} must be strictly increasing")
    return breaks


def _validated_lines(lines: NDArray[np.floating], name: str) -> NDArray[np.float64]:
    values = np.asarray(lines, dtype=np.float64)
    if values.ndim != 3 or values.shape[1:] != (2, 2) or values.shape[0] < 2:
        raise ValueError(f"{name} must contain at least two line segments")
    if not np.isfinite(values).all():
        raise ValueError(f"{name} must contain finite coordinates")
    if np.any(np.linalg.norm(values[:, 1] - values[:, 0], axis=1) <= 1e-8):
        raise ValueError(f"{name} contains a zero-length segment")
    return values


def _validated_groups(
    groups: Sequence[NDArray[np.floating]], name: str
) -> tuple[NDArray[np.float64], ...]:
    checked: list[NDArray[np.float64]] = []
    for index, group in enumerate(groups):
        values = np.asarray(group, dtype=np.float64)
        if values.ndim != 2 or values.shape[1] != 2 or values.shape[0] < 2:
            raise ValueError(f"{name}[{index}] must contain at least two points")
        if not np.isfinite(values).all():
            raise ValueError(f"{name}[{index}] must contain finite coordinates")
        checked.append(values)
    return tuple(checked)


def build_regular_mesh(
    width: int,
    height: int,
    columns: NDArray[np.floating],
    rows: NDArray[np.floating],
    bounds: tuple[float, float, float, float] | None = None,
) -> NDArray[np.float64]:
    if width < 2 or height < 2:
        raise ValueError("mesh canvas must be at least 2 by 2")
    x_breaks = _validated_breaks(columns, "columns")
    y_breaks = _validated_breaks(rows, "rows")
    left, top, right, bottom = bounds or (0.0, 0.0, width - 1.0, height - 1.0)
    if not np.isfinite((left, top, right, bottom)).all() or left >= right or top >= bottom:
        raise ValueError("mesh bounds must enclose a finite rectangle")
    xs = left + x_breaks * (right - left)
    ys = top + y_breaks * (bottom - top)
    xx, yy = np.meshgrid(xs, ys)
    return np.stack((xx, yy), axis=-1).astype(np.float64)


def _grid_axes(base_vertices: NDArray[np.floating]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    base = np.asarray(base_vertices, dtype=np.float64)
    if base.ndim != 3 or base.shape[2] != 2 or base.shape[0] < 3 or base.shape[1] < 3:
        raise ValueError("base_vertices must be a grid of at least 3 by 3")
    xs = base[0, :, 0]
    ys = base[:, 0, 1]
    if not np.allclose(base[:, :, 0], xs[np.newaxis, :]) or not np.allclose(
        base[:, :, 1], ys[:, np.newaxis]
    ):
        raise ValueError("base_vertices must form an axis-aligned rectangular grid")
    if np.any(np.diff(xs) <= 0) or np.any(np.diff(ys) <= 0):
        raise ValueError("base_vertices axes must be strictly increasing")
    return xs, ys


def _bilinear_values(
    points: NDArray[np.floating],
    base_vertices: NDArray[np.floating],
    vertex_values: NDArray[np.floating],
) -> NDArray[np.float64]:
    coordinates = np.asarray(points, dtype=np.float64)
    base = np.asarray(base_vertices, dtype=np.float64)
    values = np.asarray(vertex_values, dtype=np.float64)
    if coordinates.ndim != 2 or coordinates.shape[1] != 2 or not np.isfinite(coordinates).all():
        raise ValueError("points must be a finite N by 2 array")
    if values.shape != base.shape or not np.isfinite(values).all():
        raise ValueError("vertex_values must match base_vertices")
    xs, ys = _grid_axes(base)
    clipped_x = np.clip(coordinates[:, 0], xs[0], xs[-1])
    clipped_y = np.clip(coordinates[:, 1], ys[0], ys[-1])
    column = np.clip(np.searchsorted(xs, clipped_x, side="right") - 1, 0, xs.size - 2)
    row = np.clip(np.searchsorted(ys, clipped_y, side="right") - 1, 0, ys.size - 2)
    u = (clipped_x - xs[column]) / (xs[column + 1] - xs[column])
    v = (clipped_y - ys[row]) / (ys[row + 1] - ys[row])
    top = values[row, column] * (1.0 - u[:, None]) + values[row, column + 1] * u[:, None]
    bottom = values[row + 1, column] * (1.0 - u[:, None]) + values[
        row + 1, column + 1
    ] * u[:, None]
    return top * (1.0 - v[:, None]) + bottom * v[:, None]


def map_points_with_mesh(
    points: NDArray[np.floating],
    base_vertices: NDArray[np.floating],
    displacements: NDArray[np.floating],
) -> NDArray[np.float64]:
    coordinates = np.asarray(points, dtype=np.float64)
    return coordinates + _bilinear_values(coordinates, base_vertices, displacements)


def _geometry_residuals(
    displacements: NDArray[np.float64],
    base_vertices: NDArray[np.float64],
    horizontal_lines: NDArray[np.float64],
    vertical_lines: NDArray[np.float64],
    axis_groups: tuple[NDArray[np.float64], ...],
    level_groups: tuple[NDArray[np.float64], ...],
) -> dict[str, NDArray[np.float64]]:
    mapped_horizontal = map_points_with_mesh(
        horizontal_lines.reshape(-1, 2), base_vertices, displacements
    ).reshape(horizontal_lines.shape)
    mapped_vertical = map_points_with_mesh(
        vertical_lines.reshape(-1, 2), base_vertices, displacements
    ).reshape(vertical_lines.shape)
    horizontal = mapped_horizontal[:, 1, 1] - mapped_horizontal[:, 0, 1]
    vertical = mapped_vertical[:, 1, 0] - mapped_vertical[:, 0, 0]
    axes = np.concatenate(
        [
            mapped[:, 0] - mapped[:, 0].mean()
            for mapped in (
                map_points_with_mesh(group, base_vertices, displacements)
                for group in axis_groups
            )
        ]
    ) if axis_groups else np.empty(0, dtype=np.float64)
    levels = np.concatenate(
        [
            mapped[:, 1] - mapped[:, 1].mean()
            for mapped in (
                map_points_with_mesh(group, base_vertices, displacements)
                for group in level_groups
            )
        ]
    ) if level_groups else np.empty(0, dtype=np.float64)
    return {
        "horizontal": horizontal,
        "vertical": vertical,
        "axis": axes,
        "level": levels,
    }


def _rms(parts: Mapping[str, NDArray[np.float64]]) -> float:
    arrays = [values for values in parts.values() if values.size]
    if not arrays:
        return 0.0
    values = np.concatenate(arrays)
    return float(np.sqrt(np.mean(np.square(values))))


def optimize_mesh(
    base_vertices: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    axis_groups: Sequence[NDArray[np.floating]] = (),
    level_groups: Sequence[NDArray[np.floating]] = (),
    max_displacement: tuple[float, float] = (24.0, 18.0),
    weights: Mapping[str, float] | None = None,
) -> MeshOptimizationResult:
    base = np.asarray(base_vertices, dtype=np.float64)
    _grid_axes(base)
    horizontal = _validated_lines(horizontal_lines, "horizontal_lines")
    vertical = _validated_lines(vertical_lines, "vertical_lines")
    axes = _validated_groups(axis_groups, "axis_groups")
    levels = _validated_groups(level_groups, "level_groups")
    max_dx, max_dy = (float(max_displacement[0]), float(max_displacement[1]))
    if not np.isfinite((max_dx, max_dy)).all() or max_dx <= 0 or max_dy <= 0:
        raise ValueError("max_displacement must contain two positive finite values")
    configured = dict(DEFAULT_WEIGHTS)
    if weights:
        unknown = set(weights) - set(configured)
        if unknown:
            raise ValueError(f"unknown optimizer weights: {sorted(unknown)}")
        configured.update({name: float(value) for name, value in weights.items()})
    if not np.isfinite(tuple(configured.values())).all() or any(value < 0 for value in configured.values()):
        raise ValueError("optimizer weights must be finite and non-negative")

    variable_mask = np.zeros(base.shape, dtype=bool)
    variable_mask[1:-1, 1:-1, :] = True
    variable_mask[1:-1, 0, 1] = True
    variable_mask[1:-1, -1, 1] = True
    variable_mask[0, 1:-1, 0] = True
    variable_mask[-1, 1:-1, 0] = True

    def unpack(parameters: NDArray[np.float64]) -> NDArray[np.float64]:
        displacement = np.zeros_like(base)
        displacement[variable_mask] = parameters
        return displacement

    def residual(parameters: NDArray[np.float64]) -> NDArray[np.float64]:
        displacement = unpack(parameters)
        geometry = _geometry_residuals(
            displacement, base, horizontal, vertical, axes, levels
        )
        parts: list[NDArray[np.float64]] = []
        for name in ("horizontal", "vertical", "axis", "level"):
            if geometry[name].size and configured[name] > 0:
                parts.append(geometry[name] * configured[name])

        optimized = base + displacement
        horizontal_edges = optimized[:, 1:] - optimized[:, :-1]
        base_horizontal_edges = base[:, 1:] - base[:, :-1]
        vertical_edges = optimized[1:] - optimized[:-1]
        base_vertical_edges = base[1:] - base[:-1]
        if configured["scale"] > 0:
            parts.append(
                (horizontal_edges - base_horizontal_edges).ravel() * configured["scale"]
            )
            parts.append((vertical_edges - base_vertical_edges).ravel() * configured["scale"])
        if configured["smoothness"] > 0:
            if displacement.shape[1] > 2:
                parts.append(
                    (displacement[:, 2:] - 2 * displacement[:, 1:-1] + displacement[:, :-2]).ravel()
                    * configured["smoothness"]
                )
            if displacement.shape[0] > 2:
                parts.append(
                    (displacement[2:] - 2 * displacement[1:-1] + displacement[:-2]).ravel()
                    * configured["smoothness"]
                )
        if configured["magnitude"] > 0:
            parts.append(displacement[variable_mask] * configured["magnitude"])
        if configured["boundary"] > 0:
            boundary = np.concatenate(
                (
                    displacement[0, :, 1].ravel(),
                    displacement[-1, :, 1].ravel(),
                    displacement[:, 0, 0].ravel(),
                    displacement[:, -1, 0].ravel(),
                )
            )
            parts.append(boundary * configured["boundary"])
        return np.concatenate(parts) if parts else np.zeros(1, dtype=np.float64)

    initial = np.zeros(int(variable_mask.sum()), dtype=np.float64)
    limits = np.empty_like(base)
    limits[..., 0] = max_dx
    limits[..., 1] = max_dy
    upper = limits[variable_mask]
    lower = -upper
    initial_geometry = _geometry_residuals(
        unpack(initial), base, horizontal, vertical, axes, levels
    )
    solution = least_squares(
        residual,
        initial,
        bounds=(lower, upper),
        method="trf",
        loss="soft_l1",
        f_scale=1.0,
        x_scale="jac",
        max_nfev=500,
        ftol=1e-9,
        xtol=1e-9,
        gtol=1e-9,
    )
    displacements = unpack(solution.x)
    optimized = base + displacements
    final_geometry = _geometry_residuals(
        displacements, base, horizontal, vertical, axes, levels
    )
    diagnostics: dict[str, float | int | bool | str] = {
        "success": bool(solution.success),
        "status": int(solution.status),
        "message": str(solution.message),
        "cost": float(solution.cost),
        "nfev": int(solution.nfev),
        "variable_dof": int(variable_mask.sum()),
        "initial_constraint_rms_px": _rms(initial_geometry),
        "final_constraint_rms_px": _rms(final_geometry),
        "max_abs_dx_px": float(np.max(np.abs(displacements[..., 0]))),
        "max_abs_dy_px": float(np.max(np.abs(displacements[..., 1]))),
    }
    for name, values in final_geometry.items():
        diagnostics[f"final_{name}_rms_px"] = (
            float(np.sqrt(np.mean(np.square(values)))) if values.size else 0.0
        )
    return MeshOptimizationResult(
        displacements=displacements,
        optimized_vertices=optimized,
        diagnostics=diagnostics,
    )


def optimize_structured_mesh(
    base_vertices: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    axis_groups: Sequence[NDArray[np.floating]] = (),
    level_groups: Sequence[NDArray[np.floating]] = (),
    max_displacement: tuple[float, float] = (5.0, 5.0),
    weights: Mapping[str, float] | None = None,
) -> MeshOptimizationResult:
    base = np.asarray(base_vertices, dtype=np.float64)
    _grid_axes(base)
    horizontal = _validated_lines(horizontal_lines, "horizontal_lines")
    vertical = _validated_lines(vertical_lines, "vertical_lines")
    axes = _validated_groups(axis_groups, "axis_groups")
    levels = _validated_groups(level_groups, "level_groups")
    max_dx, max_dy = (float(max_displacement[0]), float(max_displacement[1]))
    if not np.isfinite((max_dx, max_dy)).all() or max_dx <= 0 or max_dy <= 0:
        raise ValueError("max_displacement must contain two positive finite values")
    configured = dict(DEFAULT_WEIGHTS)
    if weights:
        unknown = set(weights) - set(configured)
        if unknown:
            raise ValueError(f"unknown optimizer weights: {sorted(unknown)}")
        configured.update({name: float(value) for name, value in weights.items()})
    if not np.isfinite(tuple(configured.values())).all() or any(
        value < 0 for value in configured.values()
    ):
        raise ValueError("optimizer weights must be finite and non-negative")

    column_count = base.shape[1]
    row_count = base.shape[0]
    column_dof = column_count - 2
    row_dof = row_count - 2

    def unpack(
        parameters: NDArray[np.float64],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
        column_offsets = np.zeros(column_count, dtype=np.float64)
        row_offsets = np.zeros(row_count, dtype=np.float64)
        column_offsets[1:-1] = parameters[:column_dof]
        row_offsets[1:-1] = parameters[column_dof:]
        displacement = np.empty_like(base)
        displacement[..., 0] = column_offsets[np.newaxis, :]
        displacement[..., 1] = row_offsets[:, np.newaxis]
        return displacement, column_offsets, row_offsets

    def residual(parameters: NDArray[np.float64]) -> NDArray[np.float64]:
        displacement, column_offsets, row_offsets = unpack(parameters)
        geometry = _geometry_residuals(
            displacement, base, horizontal, vertical, axes, levels
        )
        parts: list[NDArray[np.float64]] = []
        for name in ("horizontal", "vertical", "axis", "level"):
            if geometry[name].size and configured[name] > 0:
                parts.append(geometry[name] * configured[name])
        if configured["scale"] > 0:
            parts.append(np.diff(column_offsets) * configured["scale"])
            parts.append(np.diff(row_offsets) * configured["scale"])
        if configured["smoothness"] > 0:
            parts.append(np.diff(column_offsets, n=2) * configured["smoothness"])
            parts.append(np.diff(row_offsets, n=2) * configured["smoothness"])
        if configured["magnitude"] > 0:
            parts.append(column_offsets[1:-1] * configured["magnitude"])
            parts.append(row_offsets[1:-1] * configured["magnitude"])
        return np.concatenate(parts) if parts else np.zeros(1, dtype=np.float64)

    initial = np.zeros(column_dof + row_dof, dtype=np.float64)
    lower = -np.concatenate(
        (np.full(column_dof, max_dx), np.full(row_dof, max_dy))
    )
    upper = -lower
    initial_displacement, _, _ = unpack(initial)
    initial_geometry = _geometry_residuals(
        initial_displacement, base, horizontal, vertical, axes, levels
    )
    solution = least_squares(
        residual,
        initial,
        bounds=(lower, upper),
        method="trf",
        loss="soft_l1",
        f_scale=1.0,
        x_scale="jac",
        max_nfev=500,
        ftol=1e-9,
        xtol=1e-9,
        gtol=1e-9,
    )
    displacements, column_offsets, row_offsets = unpack(solution.x)
    optimized = base + displacements
    final_geometry = _geometry_residuals(
        displacements, base, horizontal, vertical, axes, levels
    )
    diagnostics: dict[str, float | int | bool | str] = {
        "success": bool(solution.success),
        "status": int(solution.status),
        "message": str(solution.message),
        "parameterization": "separable_rows_columns",
        "cost": float(solution.cost),
        "nfev": int(solution.nfev),
        "variable_dof": int(initial.size),
        "initial_constraint_rms_px": _rms(initial_geometry),
        "final_constraint_rms_px": _rms(final_geometry),
        "max_abs_dx_px": float(np.max(np.abs(column_offsets))),
        "max_abs_dy_px": float(np.max(np.abs(row_offsets))),
        "max_column_x_drift_px": float(np.max(np.ptp(optimized[..., 0], axis=0))),
        "max_row_y_drift_px": float(np.max(np.ptp(optimized[..., 1], axis=1))),
    }
    for name, values in final_geometry.items():
        diagnostics[f"final_{name}_rms_px"] = (
            float(np.sqrt(np.mean(np.square(values)))) if values.size else 0.0
        )
    return MeshOptimizationResult(
        displacements=displacements,
        optimized_vertices=optimized,
        diagnostics=diagnostics,
    )


def _triangle_area(triangle: NDArray[np.floating]) -> float:
    values = np.asarray(triangle, dtype=np.float64)
    first = values[1] - values[0]
    second = values[2] - values[0]
    return float(first[0] * second[1] - first[1] * second[0])


def count_folded_triangles(vertices: NDArray[np.floating]) -> int:
    values = np.asarray(vertices, dtype=np.float64)
    if values.ndim != 3 or values.shape[2] != 2 or values.shape[0] < 2 or values.shape[1] < 2:
        raise ValueError("vertices must be an R by C by 2 grid")
    folded = 0
    for row in range(values.shape[0] - 1):
        for column in range(values.shape[1] - 1):
            triangles = (
                values[[row, row, row + 1], [column, column + 1, column + 1]],
                values[[row, row + 1, row + 1], [column, column + 1, column]],
            )
            folded += sum(_triangle_area(triangle) <= 1e-6 for triangle in triangles)
    return int(folded)


def _write_triangle_map(
    map_x: NDArray[np.float32],
    map_y: NDArray[np.float32],
    destination: NDArray[np.float64],
    source: NDArray[np.float64],
) -> None:
    height, width = map_x.shape
    minimum = np.floor(destination.min(axis=0)).astype(int)
    maximum = np.ceil(destination.max(axis=0)).astype(int)
    x0 = max(0, int(minimum[0]))
    y0 = max(0, int(minimum[1]))
    x1 = min(width - 1, int(maximum[0]))
    y1 = min(height - 1, int(maximum[1]))
    if x0 > x1 or y0 > y1:
        return
    local_mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)
    local_triangle = np.rint(destination - np.float64([x0, y0])).astype(np.int32)
    cv2.fillConvexPoly(local_mask, local_triangle, 255, lineType=cv2.LINE_8)
    yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
    affine = cv2.getAffineTransform(destination.astype(np.float32), source.astype(np.float32))
    mapped_x = affine[0, 0] * xx + affine[0, 1] * yy + affine[0, 2]
    mapped_y = affine[1, 0] * xx + affine[1, 1] * yy + affine[1, 2]
    selection = local_mask.astype(bool)
    target_x = map_x[y0 : y1 + 1, x0 : x1 + 1]
    target_y = map_y[y0 : y1 + 1, x0 : x1 + 1]
    target_x[selection] = mapped_x[selection].astype(np.float32)
    target_y[selection] = mapped_y[selection].astype(np.float32)


def remap_with_triangular_mesh(
    image: NDArray[np.uint8],
    source_vertices: NDArray[np.floating],
    target_vertices: NDArray[np.floating],
    output_size: tuple[int, int],
    background: tuple[int, int, int] = (238, 238, 238),
) -> tuple[NDArray[np.uint8], NDArray[np.float32], NDArray[np.float32]]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    source = np.asarray(source_vertices, dtype=np.float64)
    target = np.asarray(target_vertices, dtype=np.float64)
    if source.shape != target.shape or source.ndim != 3 or source.shape[2] != 2:
        raise ValueError("source_vertices and target_vertices must have matching grid shapes")
    if not np.isfinite(source).all() or not np.isfinite(target).all():
        raise ValueError("mesh vertices must be finite")
    if count_folded_triangles(target):
        raise ValueError(f"{GEOMETRY_ERROR}: optimized mesh contains folded triangles")
    width, height = (int(output_size[0]), int(output_size[1]))
    if width < 2 or height < 2:
        raise ValueError("output_size must be at least 2 by 2")
    map_x = np.full((height, width), -1.0, dtype=np.float32)
    map_y = np.full((height, width), -1.0, dtype=np.float32)
    for row in range(target.shape[0] - 1):
        for column in range(target.shape[1] - 1):
            indices = (
                ((row, column), (row, column + 1), (row + 1, column + 1)),
                ((row, column), (row + 1, column + 1), (row + 1, column)),
            )
            for triangle_indices in indices:
                destination = np.asarray([target[index] for index in triangle_indices])
                source_triangle = np.asarray([source[index] for index in triangle_indices])
                _write_triangle_map(map_x, map_y, destination, source_triangle)
    result = cv2.remap(
        image,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=background,
    )
    return result, map_x, map_y


def build_global_canvas_transform(
    crop_polygon: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    output_width: int,
    padding: int = 0,
) -> GlobalCanvasGeometry:
    polygon = np.asarray(crop_polygon, dtype=np.float64)
    if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
        raise ValueError("crop_polygon must be a finite 4 by 2 array")
    if abs(cv2.contourArea(polygon.astype(np.float32))) <= 1e-6:
        raise ValueError("crop_polygon must enclose a non-zero area")
    if output_width < 2 or padding < 0 or output_width <= 2 * padding + 1:
        raise ValueError("output_width must leave room for padding")
    horizontal = _validated_lines(horizontal_lines, "horizontal_lines")
    vertical = _validated_lines(vertical_lines, "vertical_lines")
    axis_transform = build_axis_rectification(horizontal, vertical)
    rectified = transform_points(polygon, axis_transform)
    top_left, top_right, bottom_right, bottom_left = order_corners(
        rectified.astype(np.float32)
    ).astype(np.float64)
    minimum = np.float64(
        [max(top_left[0], bottom_left[0]), max(top_left[1], top_right[1])]
    )
    maximum = np.float64(
        [min(top_right[0], bottom_right[0]), min(bottom_left[1], bottom_right[1])]
    )
    extent = maximum - minimum
    if not np.isfinite(extent).all() or np.any(extent <= 1e-8):
        raise ValueError(f"{GEOMETRY_ERROR}: transformed crop is degenerate")
    scale = (output_width - 2 * padding) / extent[0]
    output_height = int(np.ceil(extent[1] * scale + 2 * padding))
    if output_height < 2 or output_height > output_width * 8:
        raise ValueError(f"{GEOMETRY_ERROR}: output height is unbounded")
    placement = np.float64(
        [
            [scale, 0.0, padding - scale * minimum[0]],
            [0.0, scale, padding - scale * minimum[1]],
            [0.0, 0.0, 1.0],
        ]
    )
    return GlobalCanvasGeometry(
        transform=placement @ axis_transform,
        output_size=(output_width, output_height),
        inner_bounds=(
            float(padding),
            float(padding),
            float(output_width - padding),
            float(output_height - padding),
        ),
        horizontal_vanishing_point=fit_vanishing_point(horizontal),
        vertical_vanishing_point=fit_vanishing_point(vertical),
    )


def build_union_canvas_transform(
    crop_polygon: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    output_width: int,
    padding: int = 0,
) -> GlobalCanvasGeometry:
    polygon = np.asarray(crop_polygon, dtype=np.float64)
    if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
        raise ValueError("crop_polygon must be a finite 4 by 2 array")
    if abs(cv2.contourArea(polygon.astype(np.float32))) <= 1e-6:
        raise ValueError("crop_polygon must enclose a non-zero area")
    if output_width < 2 or padding < 0 or output_width <= 2 * padding + 1:
        raise ValueError("output_width must leave room for padding")

    horizontal = _validated_lines(horizontal_lines, "horizontal_lines")
    vertical = _validated_lines(vertical_lines, "vertical_lines")
    axis_transform = build_axis_rectification(horizontal, vertical)
    rectified = transform_points(polygon, axis_transform)
    minimum = rectified.min(axis=0)
    maximum = rectified.max(axis=0)
    extent = maximum - minimum
    if not np.isfinite(extent).all() or np.any(extent <= 1e-8):
        raise ValueError(f"{GEOMETRY_ERROR}: transformed crop is degenerate")

    inner_width = output_width - 1 - 2 * padding
    scale = inner_width / extent[0]
    inner_height = int(np.ceil(extent[1] * scale))
    output_height = inner_height + 1 + 2 * padding
    if output_height < 2 or output_height > output_width * 8:
        raise ValueError(f"{GEOMETRY_ERROR}: output height is unbounded")
    placement = np.float64(
        [
            [scale, 0.0, padding - scale * minimum[0]],
            [0.0, scale, padding - scale * minimum[1]],
            [0.0, 0.0, 1.0],
        ]
    )
    return GlobalCanvasGeometry(
        transform=placement @ axis_transform,
        output_size=(output_width, output_height),
        inner_bounds=(
            float(padding),
            float(padding),
            float(output_width - 1 - padding),
            float(output_height - 1 - padding),
        ),
        horizontal_vanishing_point=fit_vanishing_point(horizontal),
        vertical_vanishing_point=fit_vanishing_point(vertical),
    )


def tight_crop_rgba(
    image: NDArray[np.uint8],
    mask: NDArray[np.uint8],
    padding: int = 0,
) -> tuple[NDArray[np.uint8], NDArray[np.uint8], tuple[int, int, int, int]]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    values = np.asarray(mask)
    if values.shape != image.shape[:2]:
        raise ValueError("mask dimensions must match image")
    if padding < 0:
        raise ValueError("padding must be non-negative")
    selection = values > 0
    if not np.any(selection):
        raise ValueError("mask must contain at least one selected pixel")

    ys, xs = np.nonzero(selection)
    x0 = max(0, int(xs.min()) - padding)
    y0 = max(0, int(ys.min()) - padding)
    x1 = min(image.shape[1], int(xs.max()) + 1 + padding)
    y1 = min(image.shape[0], int(ys.max()) + 1 + padding)
    cropped_image = image[y0:y1, x0:x1]
    cropped_mask = np.where(selection[y0:y1, x0:x1], 255, 0).astype(np.uint8)
    rgba = cv2.cvtColor(cropped_image, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = cropped_mask
    return rgba, cropped_mask, (x0, y0, x1, y1)


def rectify_with_constrained_mesh(
    image: NDArray[np.uint8],
    crop_polygon: NDArray[np.floating],
    horizontal_lines: NDArray[np.floating],
    vertical_lines: NDArray[np.floating],
    columns: NDArray[np.floating],
    rows: NDArray[np.floating],
    output_width: int,
    padding: int = 0,
    axis_groups: Sequence[NDArray[np.floating]] = (),
    level_groups: Sequence[NDArray[np.floating]] = (),
    max_displacement: tuple[float, float] = (24.0, 18.0),
    weights: Mapping[str, float] | None = None,
    background: tuple[int, int, int] = (238, 238, 238),
    canvas_mode: str = "inner",
) -> ConstrainedRectificationResult:
    if canvas_mode not in {"inner", "union"}:
        raise ValueError("canvas_mode must be 'inner' or 'union'")
    canvas_builder = (
        build_union_canvas_transform
        if canvas_mode == "union"
        else build_global_canvas_transform
    )
    geometry = canvas_builder(
        crop_polygon,
        horizontal_lines,
        vertical_lines,
        output_width=output_width,
        padding=padding,
    )
    base_vertices = build_regular_mesh(
        geometry.output_size[0],
        geometry.output_size[1],
        columns,
        rows,
        bounds=geometry.inner_bounds,
    )
    target_horizontal = transform_points(
        np.asarray(horizontal_lines, dtype=np.float64).reshape(-1, 2), geometry.transform
    ).reshape(np.asarray(horizontal_lines).shape)
    target_vertical = transform_points(
        np.asarray(vertical_lines, dtype=np.float64).reshape(-1, 2), geometry.transform
    ).reshape(np.asarray(vertical_lines).shape)
    target_axes = tuple(transform_points(group, geometry.transform) for group in axis_groups)
    target_levels = tuple(transform_points(group, geometry.transform) for group in level_groups)
    optimization = optimize_structured_mesh(
        base_vertices,
        target_horizontal,
        target_vertical,
        axis_groups=target_axes,
        level_groups=target_levels,
        max_displacement=max_displacement,
        weights=weights,
    )
    inverse_global = np.linalg.inv(geometry.transform)
    source_vertices = transform_points(base_vertices.reshape(-1, 2), inverse_global).reshape(
        base_vertices.shape
    )
    folded = count_folded_triangles(optimization.optimized_vertices)
    if folded:
        raise ValueError(f"{GEOMETRY_ERROR}: optimization folded {folded} triangles")
    result, map_x, map_y = remap_with_triangular_mesh(
        image,
        source_vertices,
        optimization.optimized_vertices,
        geometry.output_size,
        background=background,
    )
    diagnostics: dict[str, object] = {
        "optimizer": optimization.diagnostics,
        "output_width": geometry.output_size[0],
        "output_height": geometry.output_size[1],
        "horizontal_vanishing_point": geometry.horizontal_vanishing_point.tolist(),
        "vertical_vanishing_point": geometry.vertical_vanishing_point.tolist(),
        "folded_triangles": folded,
        "resample_passes": 1,
        "canvas_mode": canvas_mode,
    }
    return ConstrainedRectificationResult(
        image=result,
        map_x=map_x,
        map_y=map_y,
        global_transform=geometry.transform,
        base_vertices=base_vertices,
        optimized_vertices=optimization.optimized_vertices,
        source_vertices=source_vertices,
        diagnostics=diagnostics,
    )
