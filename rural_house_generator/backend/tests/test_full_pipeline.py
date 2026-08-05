from __future__ import annotations

import cv2
import numpy as np

from rural_house_generator.backend.app.facade.full_pipeline import _architectural_lines, _mask_polygon, _tight_mask_crop


def test_mask_polygon_uses_the_complete_main_building_extent():
    mask = np.zeros((100, 160), np.uint8)
    mask[10:91, 20:141] = 255

    polygon = _mask_polygon(mask)

    assert np.array_equal(polygon, [[20, 10], [140, 10], [140, 90], [20, 90]])


def test_tight_mask_crop_removes_blank_sides_without_cutting_building():
    image = np.full((80, 140, 3), 238, np.uint8)
    mask = np.zeros((80, 140), np.uint8)
    mask[5:76, 30:111] = 255

    cropped, bounds = _tight_mask_crop(image, mask, padding_ratio=0)

    assert bounds == (28, 3, 113, 78)
    assert cropped.shape[:2] == (75, 85)


def test_line_detection_is_limited_to_the_sam_building_mask():
    image = np.full((240, 360, 3), 230, np.uint8)
    mask = np.zeros((240, 360), np.uint8)
    mask[40:220, 70:310] = 255
    for y in (60, 110, 160, 210):
        cv2.line(image, (80, y), (300, y + 5), (20, 20, 20), 3)
    for x in (90, 150, 220, 290):
        cv2.line(image, (x, 50), (x + 4, 215), (20, 20, 20), 3)

    horizontal, vertical = _architectural_lines(image, mask)

    assert len(horizontal) >= 2
    assert len(vertical) >= 2
    assert np.all(horizontal[:, 1, 0] >= horizontal[:, 0, 0])
    assert np.all(vertical[:, 1, 1] >= vertical[:, 0, 1])
