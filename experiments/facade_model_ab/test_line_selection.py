from __future__ import annotations

import numpy as np

from experiments.facade_model_ab.line_selection import select_axis_lines


def test_select_axis_lines_filters_short_low_score_and_mask_outside_segments() -> None:
    segments = np.array(
        [
            [[0.10, 0.20], [0.90, 0.20]],  # horizontal
            [[0.20, 0.10], [0.20, 0.90]],  # vertical
            [[0.40, 0.40], [0.43, 0.40]],  # too short
            [[0.10, 0.70], [0.90, 0.70]],  # low score
            [[0.01, 0.05], [0.01, 0.95]],  # outside mask
        ],
        dtype=np.float64,
    )
    scores = np.array([0.95, 0.90, 0.99, 0.10, 0.95], dtype=np.float64)
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[:, 10:91] = 255

    result = select_axis_lines(
        segments,
        scores,
        facade_mask=mask,
        min_length=0.10,
        min_score=0.25,
        min_mask_support=0.60,
    )

    np.testing.assert_allclose(result.horizontal, segments[[0]])
    np.testing.assert_allclose(result.vertical, segments[[1]])
    assert result.accepted_indices.tolist() == [0, 1]
    assert result.rejected_counts == {
        "too_short": 1,
        "low_score": 1,
        "outside_mask": 1,
    }


def test_select_axis_lines_suppresses_near_duplicate_segments() -> None:
    segments = np.array(
        [
            [[0.10, 0.30], [0.90, 0.30]],
            [[0.11, 0.305], [0.89, 0.305]],
            [[0.10, 0.60], [0.90, 0.60]],
            [[0.25, 0.10], [0.25, 0.90]],
        ],
        dtype=np.float64,
    )

    result = select_axis_lines(
        segments,
        np.array([0.9, 0.8, 0.9, 0.9]),
        duplicate_distance=0.02,
    )

    assert result.horizontal.shape[0] == 2
    assert result.vertical.shape[0] == 1
    assert result.rejected_counts == {"duplicate": 1}


def test_select_axis_lines_rejects_direction_outlier_from_vanishing_consensus() -> None:
    segments = np.array(
        [
            [[0.10, 0.20], [0.90, 0.24]],
            [[0.10, 0.40], [0.90, 0.44]],
            [[0.10, 0.60], [0.90, 0.64]],
            [[0.10, 0.80], [0.70, 0.60]],  # diagonal wire-like outlier
            [[0.25, 0.10], [0.24, 0.90]],
            [[0.70, 0.10], [0.69, 0.90]],
        ],
        dtype=np.float64,
    )

    result = select_axis_lines(
        segments,
        np.full(segments.shape[0], 0.9),
        consensus_angle_deg=6.0,
    )

    assert result.horizontal.shape[0] == 3
    assert result.vertical.shape[0] == 2
    assert result.rejected_counts == {"direction_outlier": 1}
    assert 0.0 <= result.horizontal_inlier_ratio <= 1.0
    assert 0.0 <= result.vertical_inlier_ratio <= 1.0

