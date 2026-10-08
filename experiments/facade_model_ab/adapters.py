from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import sys
import types
from typing import Any

import cv2
import numpy as np

from experiments.facade_model_ab.contracts import (
    CalibrationResult,
    LineDetectionResult,
    ModelAvailability,
    ModelUnavailable,
)


ModelLoader = Callable[[], Any]


def _flatten_image_points(points: np.ndarray, expected_count: int) -> np.ndarray:
    flattened = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    if flattened.shape != (expected_count, 2) or not np.isfinite(flattened).all():
        raise ValueError("GeoCalib returned unexpected point shape")
    return flattened


def opencv_lsd_compat(
    image: np.ndarray,
    *,
    scale: float = 1.0,
    gradnorm: np.ndarray | None = None,
    gradangle: np.ndarray | None = None,
    grad_nfa: bool = True,
) -> np.ndarray:
    """Provide the pytlsd call shape when its old Windows extension is unavailable."""

    del scale, gradnorm, gradangle, grad_nfa
    gray = np.clip(np.asarray(image), 0, 255).astype(np.uint8)
    detector = cv2.createLineSegmentDetector(cv2.LSD_REFINE_ADV)
    detected = detector.detect(gray)[0]
    if detected is None:
        return np.empty((0, 4), dtype=np.float64)
    return np.asarray(detected, dtype=np.float64).reshape(-1, 4)


def _fit_homography_to_canvas(matrix: np.ndarray, width: int, height: int) -> np.ndarray:
    corners = np.array(
        [[0.0, 0.0], [width - 1.0, 0.0], [width - 1.0, height - 1.0], [0.0, height - 1.0]],
        dtype=np.float64,
    )
    homogeneous = np.column_stack((corners, np.ones(4)))
    mapped = (matrix @ homogeneous.T).T
    mapped = mapped[:, :2] / mapped[:, 2, None]
    minimum = mapped.min(axis=0)
    maximum = mapped.max(axis=0)
    extent = maximum - minimum
    if not np.isfinite(extent).all() or np.any(extent <= 1e-6):
        raise ValueError("GeoCalib leveling transform is degenerate")
    fit_scale = min((width - 1.0) / extent[0], (height - 1.0) / extent[1])
    fitted_extent = extent * fit_scale
    offset = (np.array([width - 1.0, height - 1.0]) - fitted_extent) * 0.5
    placement = np.array(
        [
            [fit_scale, 0.0, offset[0] - fit_scale * minimum[0]],
            [0.0, fit_scale, offset[1] - fit_scale * minimum[1]],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    return placement @ matrix


class _GeoCalibBackend:
    def __init__(self, checkpoint: Path, device: str, camera_model: str) -> None:
        import torch
        from geocalib import GeoCalib

        self.torch = torch
        self.device = torch.device(device)
        self.camera_model = camera_model
        self.model = GeoCalib(weights=str(checkpoint)).to(self.device).eval()

    def calibrate(self, image: np.ndarray) -> CalibrationResult:
        torch = self.torch
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div(255.0).to(self.device)
        with torch.no_grad():
            raw = self.model.calibrate(tensor, camera_model=self.camera_model)
        camera = raw["camera"]
        gravity = raw["gravity"]
        intrinsic = camera.K[0].detach().cpu().numpy().astype(np.float64)
        rotation = gravity.R[0].detach().cpu().numpy().astype(np.float64)
        leveling = intrinsic @ rotation.T @ np.linalg.inv(intrinsic)
        height, width = image.shape[:2]
        leveling = _fit_homography_to_canvas(leveling, width, height)

        if self.camera_model == "pinhole":
            undistorted = image
            point_mapper = None
        else:
            with torch.no_grad():
                undistorted_tensor = camera.undistort_image(tensor[None])[0]
            undistorted_rgb = (
                undistorted_tensor.detach().cpu().permute(1, 2, 0).clamp(0, 1).numpy() * 255.0
            ).round().astype(np.uint8)
            undistorted = cv2.cvtColor(undistorted_rgb, cv2.COLOR_RGB2BGR)

            def point_mapper(points: np.ndarray) -> np.ndarray:
                point_tensor = torch.as_tensor(points, dtype=camera.dtype, device=camera.device)
                with torch.no_grad():
                    rays, valid_a = camera.image2world(point_tensor)
                    pinhole_points, valid_b = camera.pinhole().world2image(rays)
                if not bool(torch.all(valid_a & valid_b)):
                    raise ValueError("GeoCalib could not undistort all control points")
                pinhole_numpy = _flatten_image_points(
                    pinhole_points.detach().cpu().numpy(), len(points)
                )
                homogeneous = np.column_stack((pinhole_numpy, np.ones(len(pinhole_numpy))))
                mapped = (leveling @ homogeneous.T).T
                return mapped[:, :2] / mapped[:, 2, None]

        working = cv2.warpPerspective(
            undistorted,
            leveling,
            (width, height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(238, 238, 238),
        )
        roll, pitch = gravity.rp[0].detach().cpu().numpy()
        metadata: dict[str, Any] = {
            "provider": "geocalib",
            "camera_model": self.camera_model,
            "roll_deg": float(np.degrees(roll)),
            "pitch_deg": float(np.degrees(pitch)),
            "vertical_fov_deg": float(np.degrees(camera.vfov[0].detach().cpu().item())),
            "focal_px": float(camera.f[0, 1].detach().cpu().item()),
        }
        if hasattr(camera, "dist"):
            metadata["distortion"] = camera.dist[0].detach().cpu().numpy().tolist()
        return CalibrationResult(
            image=working,
            source_to_working=leveling,
            source_point_mapper=point_mapper,
            metadata=metadata,
        )


class _DeepLSDBackend:
    def __init__(self, checkpoint: Path, device: str, max_side: int) -> None:
        import torch

        try:
            import pytlsd  # noqa: F401
            self.extraction_backend = "official_pytlsd"
        except (ImportError, OSError):
            compatibility = types.ModuleType("pytlsd")
            compatibility.lsd = opencv_lsd_compat
            sys.modules["pytlsd"] = compatibility
            self.extraction_backend = "opencv_lsd_compat"
        from deeplsd.models.deeplsd_inference import DeepLSD

        self.torch = torch
        self.device = torch.device(device)
        self.max_side = int(max_side)
        conf = {
            "detect_lines": True,
            "line_detection_params": {
                "merge": False,
                "filtering": "normal",
                "grad_thresh": 3,
                "grad_nfa": True,
            },
        }
        checkpoint_data = torch.load(str(checkpoint), map_location="cpu", weights_only=False)
        self.model = DeepLSD(conf)
        self.model.load_state_dict(checkpoint_data["model"])
        self.model = self.model.to(self.device).eval()

    def detect(self, image: np.ndarray) -> dict[str, np.ndarray]:
        torch = self.torch
        original_height, original_width = image.shape[:2]
        resize = min(1.0, self.max_side / max(original_height, original_width))
        width = max(32, int(round(original_width * resize / 32.0)) * 32)
        height = max(32, int(round(original_height * resize / 32.0)) * 32)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (width, height), interpolation=cv2.INTER_AREA)
        inputs = {
            "image": torch.from_numpy(resized).float()[None, None].div(255.0).to(self.device)
        }
        with torch.no_grad():
            output = self.model(inputs)
        lines = np.asarray(output["lines"][0], dtype=np.float64)
        if lines.size == 0:
            lines = np.empty((0, 2, 2), dtype=np.float64)
        else:
            lines = lines.reshape(-1, 2, 2)
            lines *= np.array([original_width / width, original_height / height])
        scores = np.ones(lines.shape[0], dtype=np.float64)
        return {
            "lines": lines,
            "scores": scores,
            "extraction_backend": np.asarray(self.extraction_backend),
        }


class _LazyAdapter:
    dependency_name = "optional model"

    def __init__(self, model_loader: ModelLoader | None = None) -> None:
        self._model_loader = model_loader or self._default_loader
        self._model: Any | None = None
        self._load_error: ModelUnavailable | None = None

    def _default_loader(self) -> Any:
        raise ImportError(f"{self.dependency_name} is not installed")

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        if self._load_error is not None:
            raise self._load_error
        try:
            self._model = self._model_loader()
        except (ImportError, ModuleNotFoundError, OSError) as exc:
            self._load_error = ModelUnavailable(
                f"dependency_unavailable: {self.dependency_name}: {exc}"
            )
            raise self._load_error from exc
        return self._model

    def availability(self) -> ModelAvailability:
        try:
            self._load()
        except ModelUnavailable as exc:
            return ModelAvailability(False, "dependency_unavailable", str(exc))
        return ModelAvailability(True, "available", f"{self.dependency_name} loaded")


class GeoCalibAdapter(_LazyAdapter):
    dependency_name = "geocalib"

    def __init__(
        self,
        checkpoint: Path | None = None,
        *,
        device: str = "auto",
        camera_model: str = "pinhole",
        model_loader: ModelLoader | None = None,
    ) -> None:
        self.checkpoint = None if checkpoint is None else Path(checkpoint)
        self.device = device
        self.camera_model = camera_model
        super().__init__(model_loader=model_loader)

    def _default_loader(self) -> Any:
        if self.checkpoint is None or not self.checkpoint.is_file():
            raise OSError("GeoCalib checkpoint is missing")
        import torch

        device = "cuda" if self.device == "auto" and torch.cuda.is_available() else self.device
        if device == "auto":
            device = "cpu"
        return _GeoCalibBackend(self.checkpoint, device, self.camera_model)

    def calibrate(self, image: np.ndarray) -> CalibrationResult:
        model = self._load()
        result = model.calibrate(image)
        if isinstance(result, CalibrationResult):
            return result
        raise TypeError("GeoCalib backend must return CalibrationResult")


class DeepLSDAdapter(_LazyAdapter):
    dependency_name = "deeplsd"

    def __init__(
        self,
        checkpoint: Path | None = None,
        *,
        device: str = "auto",
        max_side: int = 1024,
        model_loader: ModelLoader | None = None,
    ) -> None:
        self.checkpoint = None if checkpoint is None else Path(checkpoint)
        self.device = device
        self.max_side = max_side
        super().__init__(model_loader=model_loader)

    def _default_loader(self) -> Any:
        if self.checkpoint is None or not self.checkpoint.is_file():
            raise OSError("DeepLSD checkpoint is missing")
        import torch

        device = "cuda" if self.device == "auto" and torch.cuda.is_available() else self.device
        if device == "auto":
            device = "cpu"
        return _DeepLSDBackend(self.checkpoint, device, self.max_side)

    def detect(self, image: np.ndarray) -> LineDetectionResult:
        if image.ndim != 3 or image.shape[0] <= 0 or image.shape[1] <= 0:
            raise ValueError("image must have nonzero height and width")
        prediction = self._load().detect(image)
        segments = np.asarray(prediction["lines"], dtype=np.float64)
        scores = np.asarray(prediction["scores"], dtype=np.float64)
        if segments.ndim != 3 or segments.shape[1:] != (2, 2):
            raise ValueError("line segments must have shape [N, 2, 2]")
        if scores.shape != (segments.shape[0],):
            raise ValueError("line scores must have shape [N]")
        if not np.isfinite(segments).all() or not np.isfinite(scores).all():
            raise ValueError("line segments and scores must be finite")
        height, width = image.shape[:2]
        lower = segments.min(axis=1)
        upper = segments.max(axis=1)
        valid = np.all(lower >= -1.0, axis=1) & np.all(
            upper <= np.array([width, height]) + 1.0, axis=1
        )
        if not np.any(valid):
            raise ValueError("line segments must fall within source image bounds")
        segments = segments[valid]
        scores = scores[valid]
        clipped = segments.copy()
        clipped[..., 0] = np.clip(clipped[..., 0], 0.0, float(width))
        clipped[..., 1] = np.clip(clipped[..., 1], 0.0, float(height))
        normalized = clipped / np.array([width, height], dtype=np.float64)
        metadata = {"source_width": width, "source_height": height}
        if "extraction_backend" in prediction:
            metadata["extraction_backend"] = str(prediction["extraction_backend"])
        return LineDetectionResult(
            segments=normalized,
            scores=scores,
            metadata=metadata,
        )
