from __future__ import annotations

import cv2
import numpy as np
import pytest

from experiments.facade_layering.layered_rectify import (
    InvalidLayerError,
    LayerSpec,
    composite_planar_layer,
    rectify_base,
)


def _skewed_facade_fixture() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    source = np.full((300, 450, 3), 230, dtype=np.uint8)
    base_quad = np.float32([[50, 35], [390, 55], [420, 270], [30, 260]])
    balcony_quad = np.float32([[95, 105], [365, 112], [375, 165], [85, 160]])

    cv2.fillConvexPoly(source, balcony_quad.astype(np.int32), (180, 120, 40))
    for ratio in (0.2, 0.4, 0.6, 0.8):
        top = balcony_quad[0] * (1 - ratio) + balcony_quad[1] * ratio
        bottom = balcony_quad[3] * (1 - ratio) + balcony_quad[2] * ratio
        cv2.line(source, tuple(top.astype(int)), tuple(bottom.astype(int)), (10, 10, 10), 3)
    return source, base_quad, balcony_quad


def test_balcony_layer_fills_the_requested_axis_aligned_box():
    """Catches reusing the base homography, which leaves balcony edges skewed."""
    source, base_quad, balcony_quad = _skewed_facade_fixture()
    canvas, _ = rectify_base(source, base_quad, output_size=(640, 480))

    result, mask = composite_planar_layer(
        canvas,
        source,
        LayerSpec(
            source_quad=balcony_quad,
            destination_box=(0.1, 0.25, 0.9, 0.45),
            feather_px=0,
        ),
    )

    assert result.shape == (480, 640, 3)
    assert mask[120:216, 64:576].min() == 255
    assert mask[:119].max() == 0
    assert mask[217:].max() == 0
    assert np.linalg.norm(result[168, 320].astype(int) - np.array([180, 120, 40])) < 20


def test_feathered_layer_has_a_soft_boundary():
    """Catches a hard alpha edge that makes the balcony patch look pasted on."""
    source, base_quad, balcony_quad = _skewed_facade_fixture()
    canvas, _ = rectify_base(source, base_quad, output_size=(640, 480))

    _, mask = composite_planar_layer(
        canvas,
        source,
        LayerSpec(
            source_quad=balcony_quad,
            destination_box=(0.1, 0.25, 0.9, 0.45),
            feather_px=8,
        ),
    )

    boundary_values = mask[120:128, 320]
    assert np.any((boundary_values > 0) & (boundary_values < 255))
    assert mask[168, 320] == 255


@pytest.mark.parametrize(
    "destination_box",
    [(-0.1, 0.2, 0.9, 0.4), (0.8, 0.2, 0.2, 0.4), (0.1, 0.2, 1.1, 0.4)],
)
def test_layer_rejects_invalid_normalized_destination_box(destination_box):
    """Catches an invalid layer silently writing outside the output canvas."""
    source, base_quad, balcony_quad = _skewed_facade_fixture()
    canvas, _ = rectify_base(source, base_quad, output_size=(640, 480))

    with pytest.raises(InvalidLayerError, match="destination box"):
        composite_planar_layer(
            canvas,
            source,
            LayerSpec(
                source_quad=balcony_quad,
                destination_box=destination_box,
                feather_px=0,
            ),
        )
