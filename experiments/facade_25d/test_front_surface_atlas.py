from __future__ import annotations

import cv2
import numpy as np

from experiments.facade_25d.front_surface_atlas import (
    mask_front_surface_canvas,
    render_front_surface_atlas,
)


def test_renderer_uses_one_remap_and_tight_crops_stepped_front_surfaces(monkeypatch):
    yy, xx = np.mgrid[:100, :120]
    image = np.dstack((xx, yy, (xx + yy) % 255)).astype(np.uint8)
    polygons = (
        np.float64([[10, 10], [82, 13], [79, 42], [13, 40]]),
        np.float64([[22, 45], [103, 47], [99, 88], [25, 86]]),
    )
    calls = 0
    real_remap = cv2.remap

    def counted_remap(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real_remap(*args, **kwargs)

    monkeypatch.setattr(cv2, "remap", counted_remap)
    result = render_front_surface_atlas(
        image,
        transform=np.eye(3, dtype=np.float64),
        polygons=polygons,
        output_size=(120, 100),
        padding=0,
    )

    assert calls == 1
    assert result.resample_passes == 1
    assert result.rgba.shape[:2] == result.mask.shape
    assert np.any(result.rgba[..., 3] == 0)
    assert np.any(result.rgba[..., 3] == 255)
    assert np.any(result.mask[0] == 255)
    assert np.any(result.mask[-1] == 255)
    assert np.any(result.mask[:, 0] == 255)
    assert np.any(result.mask[:, -1] == 255)
    for polygon in result.canvas_polygons:
        assert polygon[0, 0] == polygon[3, 0]
        assert polygon[1, 0] == polygon[2, 0]
        assert polygon[0, 1] == polygon[1, 1]
        assert polygon[2, 1] == polygon[3, 1]


def test_renderer_leaves_pixels_outside_front_surface_transparent():
    image = np.full((80, 100, 3), (20, 90, 180), dtype=np.uint8)
    polygon = np.float64([[20, 15], [80, 15], [80, 65], [20, 65]])

    result = render_front_surface_atlas(
        image,
        transform=np.eye(3, dtype=np.float64),
        polygons=(polygon,),
        output_size=(100, 80),
        padding=5,
    )

    assert result.rgba.shape == (61, 71, 4)
    assert np.all(result.rgba[:5, :, 3] == 0)
    assert np.all(result.rgba[:, :5, 3] == 0)
    assert np.all(result.rgba[5:-5, 5:-5, 3] == 255)


def test_mask_existing_canvas_does_not_resample_pixels(monkeypatch):
    image = np.full((80, 100, 3), (21, 91, 181), dtype=np.uint8)
    polygon = np.float64([[20, 15], [80, 15], [80, 65], [20, 65]])

    def unexpected_remap(*args, **kwargs):
        raise AssertionError("masking an existing canvas must not resample")

    monkeypatch.setattr(cv2, "remap", unexpected_remap)
    result = mask_front_surface_canvas(image, (polygon,), padding=0)

    assert result.resample_passes == 0
    np.testing.assert_array_equal(result.rgba[..., :3], image[15:66, 20:81])
