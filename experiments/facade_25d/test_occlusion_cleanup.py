from __future__ import annotations

import cv2
import numpy as np

from experiments.facade_25d.occlusion_cleanup import (
    build_cleanup_mask,
    composite_inpainted_candidate,
)


def test_cleanup_mask_excludes_protected_polygons():
    mask = build_cleanup_mask(
        (100, 120),
        occlusion_polygons=(
            np.float64([[0.10, 0.10], [0.90, 0.10], [0.90, 0.90], [0.10, 0.90]]),
        ),
        protected_polygons=(
            np.float64([[0.40, 0.35], [0.60, 0.35], [0.60, 0.65], [0.40, 0.65]]),
        ),
    )

    assert mask.shape == (100, 120)
    assert mask[20, 20] == 255
    assert mask[50, 60] == 0
    assert mask[5, 5] == 0


def test_composite_replaces_only_masked_pixels_and_preserves_alpha():
    faithful = np.full((40, 50, 4), (10, 20, 30, 255), dtype=np.uint8)
    inpainted = np.full((40, 50, 3), (110, 120, 130), dtype=np.uint8)
    mask = np.zeros((40, 50), dtype=np.uint8)
    cv2.rectangle(mask, (10, 8), (30, 28), 255, thickness=-1)

    result = composite_inpainted_candidate(faithful, inpainted, mask)

    np.testing.assert_array_equal(result[0, 0], faithful[0, 0])
    np.testing.assert_array_equal(result[15, 20, :3], inpainted[15, 20])
    np.testing.assert_array_equal(result[..., 3], faithful[..., 3])
    np.testing.assert_array_equal(result[mask == 0], faithful[mask == 0])
