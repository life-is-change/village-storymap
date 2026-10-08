from __future__ import annotations

import cv2
import numpy as np

from experiments.facade_25d.constrained_mesh import (
    build_union_canvas_transform,
    build_regular_mesh,
    map_points_with_mesh,
    optimize_mesh,
    optimize_structured_mesh,
    rectify_with_constrained_mesh,
    remap_with_triangular_mesh,
    tight_crop_rgba,
)
from experiments.facade_25d.global_rectification import transform_points


def _constraint_rms(
    horizontal: np.ndarray,
    vertical: np.ndarray,
    axes: tuple[np.ndarray, ...],
) -> float:
    values: list[float] = []
    values.extend((horizontal[:, 1, 1] - horizontal[:, 0, 1]).tolist())
    values.extend((vertical[:, 1, 0] - vertical[:, 0, 0]).tolist())
    for group in axes:
        values.extend((group[:, 0] - group[:, 0].mean()).tolist())
    return float(np.sqrt(np.mean(np.square(values))))


def test_joint_optimizer_reduces_multistorey_residual_and_keeps_boundary_shared():
    base = build_regular_mesh(
        width=201,
        height=201,
        columns=np.float64([0.0, 0.25, 0.5, 0.75, 1.0]),
        rows=np.float64([0.0, 0.25, 0.5, 0.75, 1.0]),
    )
    horizontal = np.float64(
        [
            [[25, 50], [175, 58]],
            [[25, 100], [175, 96]],
            [[25, 150], [175, 156]],
        ]
    )
    vertical = np.float64(
        [
            [[50, 25], [56, 175]],
            [[100, 25], [96, 175]],
            [[150, 25], [143, 175]],
        ]
    )
    axes = (
        np.float64([[50, 25], [53, 100], [56, 175]]),
        np.float64([[150, 25], [147, 100], [143, 175]]),
    )

    before = _constraint_rms(horizontal, vertical, axes)
    result = optimize_mesh(
        base,
        horizontal,
        vertical,
        axis_groups=axes,
        max_displacement=(18.0, 18.0),
        weights={
            "horizontal": 6.0,
            "vertical": 6.0,
            "axis": 6.0,
            "level": 0.0,
            "boundary": 20.0,
            "scale": 0.25,
            "smoothness": 0.35,
            "magnitude": 0.05,
        },
    )
    mapped_horizontal = map_points_with_mesh(
        horizontal.reshape(-1, 2), base, result.displacements
    ).reshape(horizontal.shape)
    mapped_vertical = map_points_with_mesh(
        vertical.reshape(-1, 2), base, result.displacements
    ).reshape(vertical.shape)
    mapped_axes = tuple(
        map_points_with_mesh(group, base, result.displacements) for group in axes
    )
    after = _constraint_rms(mapped_horizontal, mapped_vertical, mapped_axes)

    assert after < before * 0.45
    np.testing.assert_allclose(result.optimized_vertices[0, :, 1], base[0, :, 1], atol=1e-5)
    np.testing.assert_allclose(result.optimized_vertices[-1, :, 1], base[-1, :, 1], atol=1e-5)
    np.testing.assert_allclose(result.optimized_vertices[:, 0, 0], base[:, 0, 0], atol=1e-5)
    np.testing.assert_allclose(result.optimized_vertices[:, -1, 0], base[:, -1, 0], atol=1e-5)
    np.testing.assert_allclose(
        result.optimized_vertices[[0, 0, -1, -1], [0, -1, 0, -1]],
        base[[0, 0, -1, -1], [0, -1, 0, -1]],
        atol=1e-5,
    )
    assert np.shares_memory(result.optimized_vertices[2], result.optimized_vertices)
    assert result.diagnostics["final_constraint_rms_px"] < result.diagnostics["initial_constraint_rms_px"]


def test_optimizer_allows_tangent_boundary_sliding_while_rectangle_normals_stay_fixed():
    base = build_regular_mesh(
        width=201,
        height=201,
        columns=np.float64([0.0, 0.25, 0.5, 0.75, 1.0]),
        rows=np.float64([0.0, 0.25, 0.5, 0.75, 1.0]),
    )
    horizontal = np.float64(
        [
            [[0, 50], [200, 62]],
            [[0, 100], [200, 92]],
            [[0, 150], [200, 157]],
        ]
    )
    vertical = np.float64(
        [
            [[50, 0], [50, 200]],
            [[100, 0], [100, 200]],
            [[150, 0], [150, 200]],
        ]
    )

    result = optimize_mesh(
        base,
        horizontal,
        vertical,
        max_displacement=(18.0, 18.0),
        weights={
            "horizontal": 10.0,
            "vertical": 2.0,
            "axis": 0.0,
            "level": 0.0,
            "boundary": 20.0,
            "scale": 0.15,
            "smoothness": 0.25,
            "magnitude": 0.02,
        },
    )
    corrected = map_points_with_mesh(
        horizontal.reshape(-1, 2), base, result.displacements
    ).reshape(horizontal.shape)

    assert np.sqrt(np.mean(np.square(corrected[:, 1, 1] - corrected[:, 0, 1]))) < 2.0
    assert np.max(np.abs(result.displacements[1:-1, (0, -1), 1])) > 1.0
    np.testing.assert_allclose(result.optimized_vertices[:, 0, 0], 0.0, atol=1e-6)
    np.testing.assert_allclose(result.optimized_vertices[:, -1, 0], 200.0, atol=1e-6)
    np.testing.assert_allclose(result.optimized_vertices[0, :, 1], 0.0, atol=1e-6)
    np.testing.assert_allclose(result.optimized_vertices[-1, :, 1], 200.0, atol=1e-6)


def test_triangular_mesh_calls_cv2_remap_once(monkeypatch):
    yy, xx = np.mgrid[:121, :161]
    image = np.dstack((xx, yy, (xx + yy) % 255)).astype(np.uint8)
    base = build_regular_mesh(
        width=161,
        height=121,
        columns=np.float64([0.0, 0.5, 1.0]),
        rows=np.float64([0.0, 0.5, 1.0]),
    )
    optimized = base.copy()
    optimized[1, 1] += np.float64([7.0, -5.0])
    calls = 0
    real_remap = cv2.remap

    def counted_remap(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real_remap(*args, **kwargs)

    monkeypatch.setattr(cv2, "remap", counted_remap)
    result, map_x, map_y = remap_with_triangular_mesh(
        image,
        source_vertices=base,
        target_vertices=optimized,
        output_size=(161, 121),
        background=(238, 238, 238),
    )

    assert calls == 1
    assert result.shape == image.shape
    assert map_x.shape == image.shape[:2]
    assert map_y.shape == image.shape[:2]
    assert np.isfinite(map_x[60, 80])
    assert np.isfinite(map_y[60, 80])


def test_structured_optimizer_keeps_every_column_collinear_and_every_row_horizontal():
    base = build_regular_mesh(
        width=401,
        height=301,
        columns=np.float64([0.0, 0.18, 0.36, 0.5, 0.64, 0.82, 1.0]),
        rows=np.float64([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]),
    )
    horizontal = np.float64(
        [
            [[20, 60], [380, 66]],
            [[20, 120], [380, 115]],
            [[20, 180], [380, 187]],
            [[20, 240], [380, 236]],
        ]
    )
    vertical = np.float64(
        [
            [[72, 15], [78, 285]],
            [[145, 15], [140, 285]],
            [[255, 15], [261, 285]],
            [[328, 15], [323, 285]],
        ]
    )
    axes = (
        np.float64([[145, 30], [143, 150], [140, 270]]),
        np.float64([[255, 30], [258, 150], [261, 270]]),
    )

    result = optimize_structured_mesh(
        base,
        horizontal,
        vertical,
        axis_groups=axes,
        max_displacement=(5.0, 5.0),
    )

    column_x_drift = np.ptp(result.optimized_vertices[:, :, 0], axis=0)
    row_y_drift = np.ptp(result.optimized_vertices[:, :, 1], axis=1)
    np.testing.assert_allclose(column_x_drift, 0.0, atol=1e-9)
    np.testing.assert_allclose(row_y_drift, 0.0, atol=1e-9)
    assert np.max(np.abs(result.displacements[..., 0])) <= 5.0 + 1e-9
    assert np.max(np.abs(result.displacements[..., 1])) <= 5.0 + 1e-9
    assert result.diagnostics["parameterization"] == "separable_rows_columns"
    assert result.diagnostics["final_constraint_rms_px"] <= result.diagnostics[
        "initial_constraint_rms_px"
    ]


def test_union_canvas_contains_every_transformed_crop_vertex():
    horizontal = np.float64(
        [
            [[50, 50], [440, 80]],
            [[35, 190], [425, 205]],
            [[20, 330], [410, 330]],
        ]
    )
    vertical = np.float64(
        [
            [[80, 30], [60, 350]],
            [[250, 45], [250, 350]],
            [[420, 65], [440, 350]],
        ]
    )
    crop = np.float64([[45, 45], [445, 75], [410, 340], [15, 325]])

    geometry = build_union_canvas_transform(
        crop,
        horizontal,
        vertical,
        output_width=420,
        padding=0,
    )
    mapped = transform_points(crop, geometry.transform)

    assert mapped[:, 0].min() >= -1e-6
    assert mapped[:, 1].min() >= -1e-6
    assert mapped[:, 0].max() <= geometry.output_size[0] - 1 + 1e-6
    assert mapped[:, 1].max() <= geometry.output_size[1] - 1 + 1e-6


def test_tight_crop_rgba_zero_padding_touches_all_four_mask_edges():
    image = np.full((90, 120, 3), (30, 80, 160), dtype=np.uint8)
    mask = np.zeros((90, 120), dtype=np.uint8)
    cv2.rectangle(mask, (17, 13), (103, 74), 255, thickness=-1)

    rgba, cropped_mask, bounds = tight_crop_rgba(image, mask, padding=0)

    assert bounds == (17, 13, 104, 75)
    assert rgba.shape == (62, 87, 4)
    assert np.all(cropped_mask[0] == 255)
    assert np.all(cropped_mask[-1] == 255)
    assert np.all(cropped_mask[:, 0] == 255)
    assert np.all(cropped_mask[:, -1] == 255)
    np.testing.assert_array_equal(rgba[..., 3], cropped_mask)


def test_constrained_rectification_union_mode_keeps_complete_crop_on_canvas():
    image = np.full((380, 500, 3), (40, 100, 180), dtype=np.uint8)
    horizontal = np.float64(
        [[[50, 50], [440, 80]], [[35, 190], [425, 205]], [[20, 330], [410, 330]]]
    )
    vertical = np.float64(
        [[[80, 30], [60, 350]], [[250, 45], [250, 350]], [[420, 65], [440, 350]]]
    )
    crop = np.float64([[45, 45], [445, 75], [410, 340], [15, 325]])

    result = rectify_with_constrained_mesh(
        image,
        crop,
        horizontal,
        vertical,
        columns=np.float64([0.0, 0.5, 1.0]),
        rows=np.float64([0.0, 0.5, 1.0]),
        output_width=420,
        padding=0,
        canvas_mode="union",
    )
    mapped = transform_points(crop, result.global_transform)

    assert mapped[:, 0].min() >= -1e-6
    assert mapped[:, 1].min() >= -1e-6
    assert mapped[:, 0].max() <= result.image.shape[1] - 1 + 1e-6
    assert mapped[:, 1].max() <= result.image.shape[0] - 1 + 1e-6
