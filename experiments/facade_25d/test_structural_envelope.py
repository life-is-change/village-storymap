from __future__ import annotations

import numpy as np

from experiments.facade_25d.structural_envelope import merge_target_building_boxes


def test_merges_vertical_parts_of_central_building_without_scene_or_neighbor():
    boxes = np.float32(
        [
            [0, 0, 1000, 780],
            [330, 180, 680, 380],
            [350, 350, 650, 700],
            [360, 670, 640, 760],
            [710, 260, 960, 720],
            [100, 120, 900, 720],
        ]
    )
    scores = np.float32([0.95, 0.72, 0.81, 0.60, 0.86, 0.93])

    result = merge_target_building_boxes(boxes, scores, image_shape=(800, 1000))

    np.testing.assert_allclose(result.envelope, [330, 180, 680, 760])
    assert result.member_indices == (1, 2, 3)
    assert 0 in result.rejected_scene_indices
    assert 5 in result.rejected_scene_indices
    assert 4 not in result.member_indices


def test_rejects_disconnected_edge_building_even_when_its_score_is_higher():
    boxes = np.float32(
        [
            [60, 160, 350, 700],
            [390, 220, 720, 430],
            [410, 400, 700, 720],
        ]
    )
    scores = np.float32([0.96, 0.70, 0.75])

    result = merge_target_building_boxes(boxes, scores, image_shape=(800, 1000))

    assert result.member_indices == (1, 2)
    np.testing.assert_allclose(result.envelope, [390, 220, 720, 720])


def test_accepts_aligned_oversize_box_only_as_vertical_completion():
    boxes = np.float32(
        [
            [330, 180, 680, 380],
            [350, 350, 650, 700],
            [310, 150, 710, 790],
            [100, 120, 900, 720],
        ]
    )
    scores = np.float32([0.72, 0.81, 0.60, 0.93])

    result = merge_target_building_boxes(boxes, scores, image_shape=(800, 1000))

    assert result.member_indices == (0, 1, 2)
    np.testing.assert_allclose(result.envelope, [310, 150, 710, 790])
    assert 3 in result.rejected_scene_indices
