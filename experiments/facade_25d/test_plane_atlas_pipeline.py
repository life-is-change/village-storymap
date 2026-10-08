from __future__ import annotations

import numpy as np

from experiments.facade_25d.plane_atlas_pipeline import (
    PlaneSpec,
    decide_inpaint,
    render_plane_atlas,
    select_intersecting_safe_components,
)


def test_inpaint_gate_rejects_large_or_border_touching_masks():
    small = np.zeros((100, 120), dtype=np.uint8)
    small[40:55, 50:65] = 255
    large = np.zeros_like(small)
    large[20:70, 20:80] = 255
    border = np.zeros_like(small)
    border[80:100, 40:60] = 255

    assert decide_inpaint(small, target_area=6000).accepted is True
    assert decide_inpaint(large, target_area=6000).reason == "mask-too-large"
    assert decide_inpaint(border, target_area=6000).reason == "touches-image-border"


def test_component_selection_keeps_whole_vehicle_when_only_part_overlaps_facade():
    mask = np.zeros((80, 100), np.uint8)
    mask[35:55, 65:90] = 255
    mask[5:30, 5:35] = 255
    target = np.zeros_like(mask)
    target[20:70, 30:75] = 255

    selected = select_intersecting_safe_components(mask, target, max_component_ratio=.25)

    assert np.all(selected[35:55, 65:90] == 255)
    assert not selected[5:30, 5:35].any()


def test_plane_atlas_rectifies_bands_and_tight_crops_side_margins():
    yy, xx = np.mgrid[:120, :180]
    image = np.dstack((xx, yy, (xx + yy) % 255)).astype(np.uint8)
    planes = (
        PlaneSpec(
            "upper",
            np.float32([[30, 20], [145, 30], [140, 60], [35, 55]]),
            (0.0, 0.0, 1.0, 0.45),
        ),
        PlaneSpec(
            "lower",
            np.float32([[35, 62], [140, 66], [135, 105], [40, 103]]),
            (0.0, 0.45, 1.0, 1.0),
        ),
    )

    result = render_plane_atlas(image, planes, output_size=(240, 180))

    assert result.rgba.shape == (180, 240, 4)
    assert np.all(result.rgba[:, 0, 3] == 255)
    assert np.all(result.rgba[:, -1, 3] == 255)
    assert result.plane_boxes == ((0, 0, 240, 81), (0, 81, 240, 180))
    assert result.resample_passes == 2
