from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from experiments.facade_25d.constrained_mesh import map_points_with_mesh
from experiments.facade_25d.global_rectification import transform_points
from experiments.facade_25d.run_constrained_mesh import run_constrained_sample
from experiments.facade_model_ab.line_selection import SelectedLines, select_axis_lines
from experiments.facade_model_ab.metrics import measure_variant
from rural_house_generator.backend.app.facade.image_io import read_image, write_image


@dataclass(frozen=True)
class VariantResult:
    name: str
    status: str
    fallback_reason: str
    artifacts: dict[str, Path]
    global_h0_count: int


def _mask_from_front_surfaces(
    payload: dict[str, Any], image_shape: tuple[int, int]
) -> np.ndarray | None:
    surfaces = payload.get("front_surfaces") or []
    if not surfaces:
        return None
    height, width = image_shape
    scale = np.array([width - 1, height - 1], dtype=np.float64)
    mask = np.zeros((height, width), dtype=np.uint8)
    for surface in surfaces:
        polygon = np.asarray(surface.get("polygon"), dtype=np.float64)
        if polygon.ndim != 2 or polygon.shape[0] < 3 or polygon.shape[1] != 2:
            raise ValueError("front surface polygon must contain at least three points")
        if not np.isfinite(polygon).all() or np.any(polygon < 0) or np.any(polygon > 1):
            raise ValueError("front surface polygon must use normalized coordinates")
        cv2.fillPoly(mask, [np.rint(polygon * scale).astype(np.int32)], 255)
    return mask


def _axis_error(horizontal: np.ndarray, vertical: np.ndarray) -> float:
    def residual(lines: np.ndarray, vertical_axis: bool) -> np.ndarray:
        delta = lines[:, 1] - lines[:, 0]
        angles = np.abs(np.degrees(np.arctan2(delta[:, 1], delta[:, 0]))) % 180.0
        return np.abs(90.0 - angles) if vertical_axis else np.minimum(angles, 180.0 - angles)

    return float(np.median(residual(horizontal, False)) + np.median(residual(vertical, True)))


def _map_normalized(
    points: object,
    matrix: np.ndarray,
    source_shape: tuple[int, int],
    working_shape: tuple[int, int],
    point_mapper: Any | None = None,
) -> list:
    values = np.asarray(points, dtype=np.float64)
    original_shape = values.shape
    source_height, source_width = source_shape
    working_height, working_width = working_shape
    source_scale = np.array([source_width - 1, source_height - 1], dtype=np.float64)
    working_scale = np.array([working_width - 1, working_height - 1], dtype=np.float64)
    pixels = values.reshape(-1, 2) * source_scale
    mapped_pixels = (
        np.asarray(point_mapper(pixels), dtype=np.float64)
        if point_mapper is not None
        else transform_points(pixels, matrix)
    )
    if mapped_pixels.shape != pixels.shape or not np.isfinite(mapped_pixels).all():
        raise ValueError("calibration point mapper returned invalid coordinates")
    mapped = mapped_pixels / working_scale
    return mapped.reshape(original_shape).tolist()


def _transform_manifest(
    payload: dict[str, Any],
    matrix: np.ndarray,
    source_shape: tuple[int, int],
    working_shape: tuple[int, int],
    point_mapper: Any | None = None,
) -> dict[str, Any]:
    transformed = copy.deepcopy(payload)
    wall = transformed["main_wall"]
    for key in ("crop_polygon", "horizontal_lines", "vertical_lines"):
        wall[key] = _map_normalized(
            wall[key], matrix, source_shape, working_shape, point_mapper
        )
    mesh = transformed["mesh"]
    for group_key in ("axis_groups", "level_groups"):
        for group in mesh.get(group_key, []):
            group["points"] = _map_normalized(
                group["points"], matrix, source_shape, working_shape, point_mapper
            )
    for surface in transformed.get("front_surfaces", []):
        surface["polygon"] = _map_normalized(
            surface["polygon"], matrix, source_shape, working_shape, point_mapper
        )
    return transformed


def _controls(payload: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    wall = payload["main_wall"]
    return (
        np.asarray(wall["horizontal_lines"], dtype=np.float64),
        np.asarray(wall["vertical_lines"], dtype=np.float64),
    )


def _write_working_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not write_image(path, image, ".png"):
        raise OSError(f"failed to write working image: {path}")


def _reset_cuda_peak() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
    except (ImportError, RuntimeError):
        return


def _cuda_peak_mb() -> float | None:
    try:
        import torch

        if torch.cuda.is_available():
            return float(torch.cuda.max_memory_allocated() / 1048576.0)
    except (ImportError, RuntimeError):
        return None
    return None


def _annotate_runtime(
    result: VariantResult, elapsed: float, cuda_peak_memory_mb: float | None
) -> VariantResult:
    metrics_path = result.artifacts["metrics"]
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    metrics["runtime_seconds"] = float(elapsed)
    metrics["cuda_peak_memory_mb"] = cuda_peak_memory_mb
    metrics_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def _variant_metrics(
    artifacts: dict[str, Path], payload: dict[str, Any], working_shape: tuple[int, int]
) -> dict[str, object]:
    parameters = json.loads(artifacts["parameters"].read_text(encoding="utf-8"))
    horizontal, vertical = _controls(payload)
    height, width = working_shape
    scale = np.array([width - 1, height - 1], dtype=np.float64)
    global_transform = np.asarray(parameters["global_transform"], dtype=np.float64)
    base = np.asarray(parameters["mesh"]["base_vertices"], dtype=np.float64)
    optimized = np.asarray(parameters["mesh"]["optimized_vertices"], dtype=np.float64)

    def mapped(lines: np.ndarray) -> np.ndarray:
        global_points = transform_points((lines * scale).reshape(-1, 2), global_transform)
        return map_points_with_mesh(global_points, base, optimized - base).reshape(lines.shape)

    output = read_image(artifacts["rectified_facade"])
    if output is None:
        raise ValueError("rectified facade cannot be decoded")
    metrics = measure_variant(
        mapped(horizontal),
        mapped(vertical),
        crop_shape=output.shape[:2],
        nonzero_crop_pixels=int(output.shape[0] * output.shape[1]),
        folded_triangles=int(parameters["mesh"]["folded_triangles"]),
        remap_passes=int(parameters["resample_passes"]),
    )
    metrics["horizontal_line_count"] = int(horizontal.shape[0])
    metrics["vertical_line_count"] = int(vertical.shape[0])
    return metrics


def _run_variant(
    name: str,
    source_image: np.ndarray,
    source_payload: dict[str, Any],
    output_root: Path,
    *,
    geocalib: Any | None,
    deeplsd: Any | None,
    facade_mask: np.ndarray | None,
    calibration_residual_tolerance_deg: float,
) -> VariantResult:
    variant_dir = output_root / name
    variant_dir.mkdir(parents=True, exist_ok=True)
    working_image = source_image.copy()
    source_shape = source_image.shape[:2]
    working_payload = copy.deepcopy(source_payload)
    calibration_metadata: dict[str, Any] | None = None

    if name in {"geocalib", "combined"}:
        if geocalib is None:
            raise RuntimeError("dependency_unavailable: geocalib adapter not configured")
        calibration = geocalib.calibrate(source_image)
        calibration_metadata = dict(calibration.metadata)
        matrix = np.asarray(calibration.source_to_working, dtype=np.float64)
        if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
            raise ValueError("invalid_geocalib_transform")
        working_image = np.asarray(calibration.image)
        if working_image.ndim != 3 or working_image.shape[2] != 3:
            raise ValueError("invalid_geocalib_image")
        working_payload = _transform_manifest(
            source_payload,
            matrix,
            source_shape,
            working_image.shape[:2],
            calibration.source_point_mapper,
        )
        before_horizontal, before_vertical = _controls(source_payload)
        after_horizontal, after_vertical = _controls(working_payload)
        if _axis_error(after_horizontal, after_vertical) > (
            _axis_error(before_horizontal, before_vertical)
            + calibration_residual_tolerance_deg
        ):
            raise ValueError("calibration_worsened_controls")
        all_points = np.concatenate(
            (
                np.asarray(working_payload["main_wall"]["crop_polygon"]).reshape(-1, 2),
                after_horizontal.reshape(-1, 2),
                after_vertical.reshape(-1, 2),
            )
        )
        if np.any(all_points < 0.0) or np.any(all_points > 1.0):
            raise ValueError("calibration_mapped_controls_outside_image")

    selection: SelectedLines | None = None
    if name in {"deeplsd", "combined"}:
        if deeplsd is None:
            raise RuntimeError("dependency_unavailable: deeplsd adapter not configured")
        detections = deeplsd.detect(working_image)
        working_mask = _mask_from_front_surfaces(working_payload, working_image.shape[:2])
        if working_mask is None and facade_mask is not None:
            if facade_mask.shape[:2] != working_image.shape[:2]:
                raise ValueError("facade mask shape must match the working image")
            working_mask = facade_mask
        selection = select_axis_lines(
            detections.segments,
            detections.scores,
            facade_mask=working_mask,
        )
        horizontal, vertical = _controls(working_payload)
        if selection.horizontal.shape[0]:
            horizontal = np.concatenate((horizontal, selection.horizontal), axis=0)
        if selection.vertical.shape[0]:
            vertical = np.concatenate((vertical, selection.vertical), axis=0)
        working_payload["main_wall"]["horizontal_lines"] = horizontal.tolist()
        working_payload["main_wall"]["vertical_lines"] = vertical.tolist()

    image_path = variant_dir / "working-image.png"
    _write_working_image(image_path, working_image)
    working_payload["image"] = image_path.name
    manifest_path = variant_dir / "variant-manifest.json"
    manifest_path.write_text(
        json.dumps(working_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    artifacts = run_constrained_sample(manifest_path, variant_dir)
    metrics = _variant_metrics(artifacts, working_payload, working_image.shape[:2])
    metrics.update({"variant": name, "status": "ok"})
    if calibration_metadata is not None:
        metrics["calibration"] = calibration_metadata
    if selection is not None:
        metrics["automatic_lines"] = {
            "accepted": int(selection.accepted_indices.size),
            "rejected": selection.rejected_counts,
            "horizontal_inlier_ratio": selection.horizontal_inlier_ratio,
            "vertical_inlier_ratio": selection.vertical_inlier_ratio,
            "extraction_backend": detections.metadata.get("extraction_backend", "unknown"),
        }
    metrics_path = variant_dir / "metrics.json"
    metrics_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    artifacts = dict(artifacts)
    artifacts["working_image"] = image_path
    artifacts["metrics"] = metrics_path
    return VariantResult(name, "ok", "", artifacts, 1)


def _fallback_variant(
    name: str, reason: str, baseline: VariantResult, output_root: Path
) -> VariantResult:
    fallback_dir = output_root / name
    fallback_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = fallback_dir / "metrics.json"
    metrics_path.write_text(
        json.dumps(
            {"variant": name, "status": "fallback", "fallback_reason": reason},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    artifacts = dict(baseline.artifacts)
    artifacts["metrics"] = metrics_path
    return VariantResult(name, "fallback", reason, artifacts, 1)


def run_sample_ab(
    manifest_path: Path,
    output_root: Path,
    *,
    geocalib: Any | None = None,
    deeplsd: Any | None = None,
    facade_mask: np.ndarray | None = None,
    calibration_residual_tolerance_deg: float = 1.0,
) -> dict[str, VariantResult]:
    manifest_path = Path(manifest_path).resolve()
    source_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_image = read_image((manifest_path.parent / source_payload["image"]).resolve())
    if source_image is None:
        raise ValueError("manifest image cannot be decoded")
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    _reset_cuda_peak()
    baseline_started = time.perf_counter()
    baseline_artifacts = run_constrained_sample(manifest_path, output_root / "baseline")
    baseline_metrics = _variant_metrics(
        baseline_artifacts, source_payload, source_image.shape[:2]
    )
    baseline_metrics.update({"variant": "baseline", "status": "ok"})
    baseline_metrics_path = output_root / "baseline" / "metrics.json"
    baseline_metrics_path.write_text(
        json.dumps(baseline_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    baseline_paths = dict(baseline_artifacts)
    baseline_paths["metrics"] = baseline_metrics_path
    baseline = VariantResult("baseline", "ok", "", baseline_paths, 1)
    baseline = _annotate_runtime(
        baseline, time.perf_counter() - baseline_started, _cuda_peak_mb()
    )
    results: dict[str, VariantResult] = {"baseline": baseline}

    for name in ("geocalib", "deeplsd", "combined"):
        _reset_cuda_peak()
        started = time.perf_counter()
        try:
            results[name] = _run_variant(
                name,
                source_image,
                source_payload,
                output_root,
                geocalib=geocalib,
                deeplsd=deeplsd,
                facade_mask=facade_mask,
                calibration_residual_tolerance_deg=calibration_residual_tolerance_deg,
            )
        except Exception as exc:  # optional-model and derived-geometry fallback boundary
            reason = f"{type(exc).__name__}: {exc}"
            results[name] = _fallback_variant(name, reason, baseline, output_root)
        results[name] = _annotate_runtime(
            results[name], time.perf_counter() - started, _cuda_peak_mb()
        )
    return results
