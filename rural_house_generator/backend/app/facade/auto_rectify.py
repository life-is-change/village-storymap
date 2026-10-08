from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .perspective import InvalidCornersError, rectify_facade


class FacadeRectificationError(ValueError):
    pass


@dataclass(frozen=True)
class RectificationResult:
    image: np.ndarray
    diagnostics: dict[str, object]


def _line_intersection(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    a = np.cross([*first[0], 1.0], [*first[1], 1.0])
    b = np.cross([*second[0], 1.0], [*second[1], 1.0])
    point = np.cross(a, b)
    if abs(point[2]) < 1e-7:
        raise FacadeRectificationError("Detected facade boundary lines do not intersect reliably")
    return (point[:2] / point[2]).astype(np.float32)


def _select_boundary(lines: np.ndarray, *, axis: int, side: str, size: int) -> np.ndarray:
    centers = lines.mean(axis=1)[:, axis]
    lengths = np.linalg.norm(lines[:, 1] - lines[:, 0], axis=1)
    threshold = size * (0.55 if side == "high" else 0.45)
    eligible = np.flatnonzero(centers >= threshold if side == "high" else centers <= threshold)
    if not eligible.size:
        raise FacadeRectificationError("Could not find both sides of the target facade")
    eligible_lengths = lengths[eligible]
    strong = eligible[eligible_lengths >= eligible_lengths.max() * 0.55]
    strong_centers = centers[strong]
    boundary_index = int(np.argmin(strong_centers) if side == "low" else np.argmax(strong_centers))
    return lines[strong[boundary_index]]


def _detect_line_families(
    image: np.ndarray, *, relaxed: bool
) -> tuple[np.ndarray, np.ndarray, int]:
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 135)
    detected = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 720,
        threshold=max(24 if relaxed else 35, min(height, width) // (28 if relaxed else 18)),
        minLineLength=max(36, width // (30 if relaxed else 9)),
        maxLineGap=max(8, width // (60 if relaxed else 45)),
    )
    if detected is None or len(detected) < 4:
        raise FacadeRectificationError("Not enough architectural lines were detected")
    lines = detected[:, 0].astype(np.float32).reshape(-1, 2, 2)
    delta = lines[:, 1] - lines[:, 0]
    horizontal = lines[np.abs(delta[:, 0]) >= np.abs(delta[:, 1]) * 1.8]
    vertical = lines[np.abs(delta[:, 1]) >= np.abs(delta[:, 0]) * 1.8]

    if relaxed:
        # Short window/column edges are useful in wide photos, while full-height
        # image borders and nearby fences are not facade boundaries.
        vertical_x = vertical.mean(axis=1)[:, 0] if len(vertical) else np.empty(0)
        vertical = vertical[
            (vertical_x >= width * 0.08) & (vertical_x <= width * 0.92)
        ]
        if len(horizontal):
            horizontal_x0 = horizontal[:, :, 0].min(axis=1)
            horizontal_x1 = horizontal[:, :, 0].max(axis=1)
            horizontal_y = horizontal.mean(axis=1)[:, 1]
            horizontal = horizontal[
                (horizontal_x1 >= width * 0.20)
                & (horizontal_x0 <= width * 0.80)
                & (horizontal_y >= height * 0.04)
                & (horizontal_y <= height * 0.96)
            ]
    if len(horizontal) < 2 or len(vertical) < 2:
        raise FacadeRectificationError("The target building lacks reliable horizontal or vertical axes")
    return horizontal, vertical, int(len(lines))


def _quad_from_line_families(
    horizontal: np.ndarray,
    vertical: np.ndarray,
    *,
    width: int,
    height: int,
) -> tuple[np.ndarray, float]:

    top = _select_boundary(horizontal, axis=1, side="low", size=height)
    bottom = _select_boundary(horizontal, axis=1, side="high", size=height)
    left = _select_boundary(vertical, axis=0, side="low", size=width)
    right = _select_boundary(vertical, axis=0, side="high", size=width)
    quad = np.float32([
        _line_intersection(top, left),
        _line_intersection(top, right),
        _line_intersection(bottom, right),
        _line_intersection(bottom, left),
    ])
    margin = np.float32([width * 0.40, height * 0.40])
    if np.any(quad < -margin) or np.any(quad > np.float32([width, height]) + margin):
        raise FacadeRectificationError("Detected facade boundary falls outside the photo")
    quad[:, 0] = np.clip(quad[:, 0], 0, width - 1)
    quad[:, 1] = np.clip(quad[:, 1], 0, height - 1)
    area_ratio = abs(cv2.contourArea(quad)) / float(width * height)
    if area_ratio < 0.12:
        raise FacadeRectificationError("Detected facade is too small; photograph the target building more directly")
    return quad, area_ratio


def detect_facade_quad(image: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise FacadeRectificationError("Facade photo must be a three-channel image")
    height, width = image.shape[:2]
    if min(height, width) < 64:
        raise FacadeRectificationError("Facade photo is too small for rectification")

    failures: list[str] = []
    for detector_pass, relaxed in (("strict", False), ("relaxed", True)):
        try:
            horizontal, vertical, line_count = _detect_line_families(image, relaxed=relaxed)
            quad, area_ratio = _quad_from_line_families(
                horizontal, vertical, width=width, height=height
            )
        except FacadeRectificationError as exc:
            failures.append(f"{detector_pass}: {exc}")
            continue
        return quad, {
            "detector_pass": detector_pass,
            "detected_line_count": line_count,
            "horizontal_line_count": int(len(horizontal)),
            "vertical_line_count": int(len(vertical)),
            "quad": quad.tolist(),
            "area_ratio": area_ratio,
        }

    raise FacadeRectificationError(
        "Could not find both sides of the target facade; " + "; ".join(failures)
    )


class AutoFacadeRectifier:
    def rectify(self, image: np.ndarray) -> RectificationResult:
        quad, diagnostics = detect_facade_quad(image)
        try:
            rectified = rectify_facade(image, quad)
        except InvalidCornersError as exc:
            raise FacadeRectificationError(str(exc)) from exc
        return RectificationResult(
            image=rectified,
            diagnostics={
                "method": "automatic_architectural_lines_single_global_h0",
                "resample_passes": 1,
                **diagnostics,
            },
        )
