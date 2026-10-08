from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_model_ab.contracts import (
    CalibrationResult,
    LineDetectionResult,
    ModelUnavailable,
)
from experiments.facade_model_ab.runner import _mask_from_front_surfaces, run_sample_ab


def _write_manifest(tmp_path: Path) -> Path:
    image = np.full((240, 320, 3), 235, dtype=np.uint8)
    for y in (50, 120, 190):
        cv2.line(image, (40, y), (280, y + 4), (20, 20, 20), 2)
    for x in (70, 160, 250):
        cv2.line(image, (x, 35), (x + 2, 205), (20, 20, 20), 2)
    image_path = tmp_path / "input.png"
    assert cv2.imwrite(str(image_path), image)
    payload = {
        "image": "input.png",
        "output_width": 320,
        "padding": 0,
        "background": [238, 238, 238],
        "main_wall": {
            "crop_polygon": [[0.12, 0.14], [0.88, 0.15], [0.88, 0.86], [0.12, 0.85]],
            "horizontal_lines": [
                [[0.12, 0.20], [0.88, 0.24]],
                [[0.12, 0.50], [0.88, 0.51]],
                [[0.12, 0.80], [0.88, 0.78]],
            ],
            "vertical_lines": [
                [[0.22, 0.15], [0.25, 0.85]],
                [[0.50, 0.15], [0.50, 0.85]],
                [[0.78, 0.15], [0.75, 0.85]],
            ],
        },
        "mesh": {
            "columns": [0.0, 0.5, 1.0],
            "rows": [0.0, 0.5, 1.0],
            "max_displacement_px": [2.0, 2.0],
            "weights": {"boundary": 20.0, "smoothness": 3.0},
            "axis_groups": [],
            "level_groups": [],
        },
    }
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    return manifest


class IdentityCalibration:
    def calibrate(self, image: np.ndarray) -> CalibrationResult:
        return CalibrationResult(
            image=image.copy(),
            source_to_working=np.eye(3, dtype=np.float64),
            metadata={"provider": "fake-geocalib", "confidence": 0.9},
        )


class UsefulLines:
    def detect(self, image: np.ndarray) -> LineDetectionResult:
        return LineDetectionResult(
            segments=np.array(
                [
                    [[0.15, 0.32], [0.85, 0.34]],
                    [[0.15, 0.67], [0.85, 0.69]],
                    [[0.35, 0.18], [0.36, 0.82]],
                    [[0.65, 0.18], [0.66, 0.82]],
                ],
                dtype=np.float64,
            ),
            scores=np.full(4, 0.9, dtype=np.float64),
        )


def test_run_sample_ab_produces_four_variants_without_mutating_manifest(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)
    original = manifest.read_bytes()

    results = run_sample_ab(
        manifest,
        tmp_path / "outputs",
        geocalib=IdentityCalibration(),
        deeplsd=UsefulLines(),
    )

    assert list(results) == ["baseline", "geocalib", "deeplsd", "combined"]
    assert all(result.status == "ok" for result in results.values())
    assert manifest.read_bytes() == original
    for result in results.values():
        assert result.global_h0_count == 1
        assert result.artifacts["rectified_facade"].is_file()
        assert result.artifacts["metrics"].is_file()
        metrics = json.loads(result.artifacts["metrics"].read_text(encoding="utf-8"))
        assert metrics["folded_triangles"] == 0
        assert metrics["remap_passes"] == 1
        assert metrics["runtime_seconds"] >= 0.0
        assert "cuda_peak_memory_mb" in metrics


def test_run_sample_ab_records_optional_model_failure_and_keeps_baseline(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)

    class MissingCalibration:
        def calibrate(self, image: np.ndarray) -> CalibrationResult:
            raise ModelUnavailable("dependency_unavailable: geocalib")

    results = run_sample_ab(
        manifest,
        tmp_path / "outputs",
        geocalib=MissingCalibration(),
        deeplsd=UsefulLines(),
    )

    assert results["baseline"].status == "ok"
    assert results["deeplsd"].status == "ok"
    assert results["geocalib"].status == "fallback"
    assert results["combined"].status == "fallback"
    assert "dependency_unavailable" in results["geocalib"].fallback_reason
    assert results["geocalib"].artifacts["rectified_facade"].is_file()


def test_run_sample_ab_rejects_calibration_that_worsens_line_consistency(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)

    class BadCalibration:
        def calibrate(self, image: np.ndarray) -> CalibrationResult:
            shear = np.array(
                [[1.0, 0.9, 0.0], [0.0, 1.0, 0.0], [0.002, 0.001, 1.0]],
                dtype=np.float64,
            )
            return CalibrationResult(image=image.copy(), source_to_working=shear)

    results = run_sample_ab(
        manifest,
        tmp_path / "outputs",
        geocalib=BadCalibration(),
        deeplsd=UsefulLines(),
        calibration_residual_tolerance_deg=0.25,
    )

    assert results["geocalib"].status == "fallback"
    assert "calibration_worsened_controls" in results["geocalib"].fallback_reason


def test_run_sample_ab_uses_nonlinear_calibration_point_mapper(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)

    class ShiftCalibration:
        def calibrate(self, image: np.ndarray) -> CalibrationResult:
            def shift(points: np.ndarray) -> np.ndarray:
                return np.asarray(points, dtype=np.float64) + np.array([2.0, 0.0])

            return CalibrationResult(
                image=image.copy(),
                source_to_working=np.eye(3, dtype=np.float64),
                source_point_mapper=shift,
            )

    results = run_sample_ab(
        manifest,
        tmp_path / "outputs",
        geocalib=ShiftCalibration(),
        deeplsd=UsefulLines(),
    )

    assert results["geocalib"].status == "ok"
    variant_manifest = json.loads(
        (tmp_path / "outputs" / "geocalib" / "variant-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    shifted_x = variant_manifest["main_wall"]["crop_polygon"][0][0]
    assert abs(shifted_x - (0.12 + 2.0 / 319.0)) < 1e-9


def test_mask_from_front_surfaces_excludes_surrounding_image() -> None:
    payload = {
        "front_surfaces": [
            {"name": "body", "polygon": [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]}
        ]
    }

    mask = _mask_from_front_surfaces(payload, (100, 200))

    assert mask is not None
    assert mask[50, 100] == 255
    assert mask[5, 5] == 0
