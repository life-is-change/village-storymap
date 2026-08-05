from __future__ import annotations

import cv2
import numpy as np
import pytest

from experiments.facade_25d.global_rectification import (
    build_axis_rectification,
    fit_vanishing_point,
    transform_points,
    warp_global_wall,
)


def _perspective_fixture() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    source = np.float32([[0, 0], [400, 0], [400, 300], [0, 300]])
    projected = np.float32([[70, 40], [460, 80], [420, 360], [30, 310]])
    perspective = cv2.getPerspectiveTransform(source, projected)
    horizontal = np.float32(
        [
            [[0, 40], [400, 40]],
            [[0, 150], [400, 150]],
            [[0, 260], [400, 260]],
        ]
    )
    vertical = np.float32(
        [
            [[50, 0], [50, 300]],
            [[200, 0], [200, 120]],
            [[200, 180], [200, 300]],
            [[350, 0], [350, 300]],
        ]
    )
    return (
        cv2.perspectiveTransform(horizontal, perspective),
        cv2.perspectiveTransform(vertical, perspective),
        perspective,
    )


def test_axis_rectification_makes_all_grid_directions_axis_aligned_and_collinear():
    horizontal, vertical, _ = _perspective_fixture()

    transform = build_axis_rectification(horizontal, vertical)
    rectified_horizontal = transform_points(horizontal.reshape(-1, 2), transform).reshape(-1, 2, 2)
    rectified_vertical = transform_points(vertical.reshape(-1, 2), transform).reshape(-1, 2, 2)

    assert np.max(np.abs(np.diff(rectified_horizontal[:, :, 1], axis=1))) < 1e-3
    assert np.max(np.abs(np.diff(rectified_vertical[:, :, 0], axis=1))) < 1e-3
    split_line_x = rectified_vertical[1:3, :, 0]
    assert np.max(split_line_x) - np.min(split_line_x) < 1e-3


@pytest.mark.parametrize(
    "lines",
    [
        np.float32([[[0, 0], [10, 0]]]),
        np.float32([[[0, 0], [0, 0]], [[0, 1], [10, 1]]]),
        np.float32([[[0, 0], [10, 0]], [[0, np.nan], [10, 1]]]),
    ],
)
def test_fit_vanishing_point_rejects_degenerate_line_sets(lines: np.ndarray):
    with pytest.raises(ValueError, match="vanishing-point geometry"):
        fit_vanishing_point(lines)


def test_warp_global_wall_uses_one_bounded_transform_for_the_complete_grid():
    horizontal, vertical, perspective = _perspective_fixture()
    rectified_image = np.full((301, 401, 3), 245, dtype=np.uint8)
    for x in (50, 200, 350):
        cv2.line(rectified_image, (x, 0), (x, 300), (20, 80, 200), 3)
    for y in (40, 150, 260):
        cv2.line(rectified_image, (0, y), (400, y), (20, 80, 200), 3)
    perspective_image = cv2.warpPerspective(
        rectified_image,
        perspective,
        (500, 400),
        borderValue=(238, 238, 238),
    )
    crop_polygon = cv2.perspectiveTransform(
        np.float32([[[0, 0], [400, 0], [400, 300], [0, 300]]]),
        perspective,
    )[0]

    result = warp_global_wall(
        perspective_image,
        crop_polygon,
        horizontal,
        vertical,
        output_width=420,
        padding=10,
    )

    assert result.image.shape == result.mask.shape + (3,)
    assert 300 <= result.image.shape[1] <= 500
    assert 200 <= result.image.shape[0] <= 500
    assert np.count_nonzero(result.mask) > 50_000
    assert result.diagnostics["max_horizontal_residual_px"] < 1e-3
    assert result.diagnostics["max_vertical_residual_px"] < 1e-3
    split_vertical = transform_points(vertical[1:3].reshape(-1, 2), result.transform)
    assert np.ptp(split_vertical[:, 0]) < 1e-3


def test_warp_global_wall_uses_an_axis_aligned_inner_crop_without_corner_wedges():
    horizontal, vertical, perspective = _perspective_fixture()
    image = np.full((400, 500, 3), (20, 80, 200), dtype=np.uint8)
    irregular_rectified_crop = np.float32(
        [[[0, 0], [400, 20], [380, 300], [20, 280]]]
    )
    crop_polygon = cv2.perspectiveTransform(irregular_rectified_crop, perspective)[0]

    result = warp_global_wall(
        image,
        crop_polygon,
        horizontal,
        vertical,
        output_width=420,
        padding=10,
    )

    assert np.all(result.mask[10:-10, 10:-10] == 255)
    assert np.all(result.mask[:10] == 0)
    assert np.all(result.mask[:, :10] == 0)
