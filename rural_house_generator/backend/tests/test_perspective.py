from __future__ import annotations

import cv2
import numpy as np
import pytest

from rural_house_generator.backend.app.facade.perspective import (
    InvalidCornersError,
    order_corners,
    rectify_facade,
)


def test_order_corners_returns_clockwise_points_from_top_left():
    """Catches shuffled points producing a mirrored or rotated facade."""
    shuffled = np.float32([[400, 250], [50, 50], [80, 250], [370, 50]])

    ordered = order_corners(shuffled)

    np.testing.assert_array_equal(
        ordered,
        np.float32([[50, 50], [370, 50], [400, 250], [80, 250]]),
    )


def test_rectify_facade_restores_the_reference_with_bounded_pixel_error(
    perspective_facade,
):
    """Catches using the forward transform or the wrong corner correspondence."""
    reference, photo, corners = perspective_facade

    rectified = rectify_facade(photo, corners)
    expected = cv2.resize(reference, (rectified.shape[1], rectified.shape[0]))
    mean_error = np.abs(rectified.astype(np.int16) - expected.astype(np.int16)).mean()

    assert rectified.shape[1] == 320
    assert 200 <= rectified.shape[0] <= 203
    assert mean_error < 8.0


def test_rectify_facade_rejects_degenerate_quadrilateral():
    """Catches a zero-area selection reaching OpenCV and yielding a blank image."""
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    collinear = np.float32([[10, 10], [20, 20], [30, 30], [40, 40]])

    with pytest.raises(InvalidCornersError, match="valid quadrilateral"):
        rectify_facade(image, collinear)
