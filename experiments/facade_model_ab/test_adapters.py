from __future__ import annotations

import numpy as np
import pytest

from experiments.facade_model_ab.adapters import (
    DeepLSDAdapter,
    GeoCalibAdapter,
    _flatten_image_points,
    opencv_lsd_compat,
)
from experiments.facade_model_ab.contracts import ModelUnavailable


def test_missing_geocalib_dependency_becomes_structured_fallback() -> None:
    def missing_loader():
        raise ImportError("geocalib is not installed")

    adapter = GeoCalibAdapter(model_loader=missing_loader)

    status = adapter.availability()

    assert status.available is False
    assert status.reason_code == "dependency_unavailable"
    assert "geocalib" in status.detail
    with pytest.raises(ModelUnavailable, match="dependency_unavailable"):
        adapter.calibrate(np.zeros((8, 12, 3), dtype=np.uint8))


def test_deeplsd_pixel_segments_are_normalized_to_source_image() -> None:
    class FakeDeepLSD:
        def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
            assert image.shape == (100, 200, 3)
            return {
                "lines": np.array(
                    [
                        [[20.0, 10.0], [180.0, 90.0]],
                        [[0.0, 50.0], [200.0, 50.0]],
                    ],
                    dtype=np.float64,
                ),
                "scores": np.array([0.75, 0.5], dtype=np.float64),
            }

    result = DeepLSDAdapter(model_loader=lambda: FakeDeepLSD()).detect(
        np.zeros((100, 200, 3), dtype=np.uint8)
    )

    np.testing.assert_allclose(
        result.segments,
        np.array(
            [
                [[0.1, 0.1], [0.9, 0.9]],
                [[0.0, 0.5], [1.0, 0.5]],
            ],
            dtype=np.float64,
        ),
    )
    np.testing.assert_allclose(result.scores, [0.75, 0.5])
    assert result.coordinate_space == "normalized_source"


def test_deeplsd_rejects_nonfinite_or_out_of_bounds_segments() -> None:
    class BadDeepLSD:
        def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
            return {
                "lines": np.array(
                    [[[0.0, 0.0], [float("nan"), 20.0]]], dtype=np.float64
                ),
                "scores": np.array([1.0], dtype=np.float64),
            }

    with pytest.raises(ValueError, match="finite"):
        DeepLSDAdapter(model_loader=lambda: BadDeepLSD()).detect(
            np.zeros((40, 60, 3), dtype=np.uint8)
        )


def test_deeplsd_clips_only_subpixel_boundary_overshoot() -> None:
    class SubpixelDeepLSD:
        def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
            return {
                "lines": np.array([[[-0.4, 10.0], [60.2, 30.0]]], dtype=np.float64),
                "scores": np.array([0.8], dtype=np.float64),
            }

    result = DeepLSDAdapter(model_loader=lambda: SubpixelDeepLSD()).detect(
        np.zeros((40, 60, 3), dtype=np.uint8)
    )
    np.testing.assert_allclose(result.segments[0, 0], [0.0, 0.25])
    np.testing.assert_allclose(result.segments[0, 1], [1.0, 0.75])

    class FarOutsideDeepLSD:
        def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
            return {
                "lines": np.array([[[-2.0, 10.0], [50.0, 30.0]]], dtype=np.float64),
                "scores": np.array([0.8], dtype=np.float64),
            }

    with pytest.raises(ValueError, match="bounds"):
        DeepLSDAdapter(model_loader=lambda: FarOutsideDeepLSD()).detect(
            np.zeros((40, 60, 3), dtype=np.uint8)
        )


def test_deeplsd_drops_far_outlier_when_other_segments_are_valid() -> None:
    class MixedDeepLSD:
        def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
            return {
                "lines": np.array(
                    [
                        [[5.0, 10.0], [55.0, 10.0]],
                        [[-3.0, 5.0], [30.0, 5.0]],
                    ],
                    dtype=np.float64,
                ),
                "scores": np.array([0.9, 0.8], dtype=np.float64),
            }

    result = DeepLSDAdapter(model_loader=lambda: MixedDeepLSD()).detect(
        np.zeros((40, 60, 3), dtype=np.uint8)
    )

    assert result.segments.shape == (1, 2, 2)
    np.testing.assert_allclose(result.scores, [0.9])


def test_opencv_lsd_compat_returns_pytlsd_shaped_finite_lines() -> None:
    image = np.zeros((96, 128), dtype=np.uint8)
    image[47:50, 10:118] = 255

    lines = opencv_lsd_compat(image.astype(np.float64))

    assert lines.ndim == 2
    assert lines.shape[1] >= 4
    assert lines.shape[0] >= 1
    assert np.isfinite(lines).all()


def test_geocalib_batched_image_points_are_flattened() -> None:
    points = np.array([[[10.0, 20.0], [30.0, 40.0]]], dtype=np.float64)

    flattened = _flatten_image_points(points, expected_count=2)

    np.testing.assert_allclose(flattened, [[10.0, 20.0], [30.0, 40.0]])


def test_geocalib_image_points_reject_wrong_count() -> None:
    with pytest.raises(ValueError, match="unexpected point shape"):
        _flatten_image_points(np.zeros((1, 3, 2)), expected_count=2)
