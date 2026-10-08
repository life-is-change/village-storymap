from __future__ import annotations

import numpy as np

from experiments.facade_model_ab.metrics import measure_variant


def test_measure_variant_reports_hand_checked_axis_residuals_and_coverage() -> None:
    horizontal = np.array(
        [
            [[0.0, 0.0], [1.0, 0.0]],
            [[0.0, 0.0], [1.0, np.tan(np.deg2rad(10.0))]],
        ],
        dtype=np.float64,
    )
    vertical = np.array(
        [
            [[0.0, 0.0], [0.0, 1.0]],
            [[0.0, 0.0], [np.tan(np.deg2rad(4.0)), 1.0]],
        ],
        dtype=np.float64,
    )
    source_mask = np.zeros((10, 10), dtype=np.uint8)
    source_mask[2:8, 2:8] = 255
    retained_mask = source_mask.copy()
    retained_mask[2:4, 2:8] = 0

    metrics = measure_variant(
        horizontal,
        vertical,
        source_facade_mask=source_mask,
        retained_facade_mask=retained_mask,
        crop_shape=(6, 8),
        nonzero_crop_pixels=36,
        folded_triangles=0,
        remap_passes=1,
    )

    assert metrics["horizontal_residual_deg"]["median"] == 5.0
    assert metrics["vertical_residual_deg"]["median"] == 2.0
    assert metrics["facade_coverage"] == 24 / 36
    assert metrics["crop_occupancy"] == 36 / 48
    assert metrics["folded_triangles"] == 0
    assert metrics["remap_passes"] == 1


def test_measure_variant_rejects_folded_mesh() -> None:
    try:
        measure_variant(
            np.empty((0, 2, 2)),
            np.empty((0, 2, 2)),
            crop_shape=(10, 10),
            nonzero_crop_pixels=100,
            folded_triangles=1,
            remap_passes=1,
        )
    except ValueError as exc:
        assert "folded" in str(exc)
    else:
        raise AssertionError("a folded mesh must be rejected")
