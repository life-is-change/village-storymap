from __future__ import annotations

import numpy as np

from rural_house_generator.backend.app.facade.direct_crop import crop_facade_body


def test_crop_facade_body_removes_top_and_blank_side_margins():
    image = np.full((100, 120, 3), 255, dtype=np.uint8)
    image[20:, 20:100] = 245
    image[35:55, 48:72] = 30

    cropped = crop_facade_body(image, 0.2)

    assert cropped.shape == (80, 84, 3)
    assert np.array_equal(cropped[:, 2:82], image[20:, 20:100])


def test_crop_facade_body_keeps_white_wall_between_detected_edges():
    image = np.full((60, 100, 3), 255, dtype=np.uint8)
    image[10:60, 20] = 20
    image[10:60, 79] = 20
    image[30:45, 45:55] = 20

    cropped = crop_facade_body(image, 10 / 60)

    assert cropped.shape == (50, 64, 3)
    assert np.all(cropped[10, 10:54] == 255)


def test_crop_facade_body_fails_open_when_no_foreground_is_detected():
    image = np.full((50, 70, 3), 255, dtype=np.uint8)

    cropped = crop_facade_body(image, 0.1)

    assert cropped.shape == (45, 70, 3)


def test_crop_facade_body_uses_aligned_building_mask_after_roof_cut():
    image = np.full((90, 120, 3), 238, dtype=np.uint8)
    image[20:, 24:96] = 245
    mask = np.zeros((90, 120), dtype=np.uint8)
    mask[10:, 24:96] = 255

    cropped = crop_facade_body(image, 20 / 90, content_mask=mask)

    assert cropped.shape == (70, 76, 3)
    assert np.array_equal(cropped[:, 2:74], image[20:, 24:96])
