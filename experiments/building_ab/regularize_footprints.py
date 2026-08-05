"""Dependency-light, rectangle-first building footprint regularization."""

from __future__ import annotations

from dataclasses import dataclass
from collections import Counter
import copy
import math
from typing import Iterable, Sequence

import cv2
import numpy as np


@dataclass(frozen=True)
class RegularizationResult:
    ring: list[tuple[float, float]]
    method: str
    vertex_count: int
    area_change_ratio: float
    rectangle_fill_ratio: float


def _open_ring(points: Sequence[Sequence[float]]) -> np.ndarray:
    ring = np.asarray(points, dtype=np.float64)
    if ring.ndim != 2 or ring.shape[1] != 2:
        raise ValueError("INVALID_RING")
    if len(ring) > 1 and np.allclose(ring[0], ring[-1], rtol=0.0, atol=1e-12):
        ring = ring[:-1]
    cleaned = []
    for point in ring:
        if not cleaned or not np.allclose(point, cleaned[-1], rtol=0.0, atol=1e-12):
            cleaned.append(point)
    ring = np.asarray(cleaned, dtype=np.float64)
    if len(ring) < 3:
        raise ValueError("INVALID_RING")
    return ring


def _signed_area(ring: np.ndarray) -> float:
    return 0.5 * float(
        np.dot(ring[:, 0], np.roll(ring[:, 1], -1))
        - np.dot(ring[:, 1], np.roll(ring[:, 0], -1))
    )


def _orientation(a, b, c) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _segments_intersect(a, b, c, d, tolerance=1e-9) -> bool:
    values = (
        _orientation(a, b, c),
        _orientation(a, b, d),
        _orientation(c, d, a),
        _orientation(c, d, b),
    )
    return values[0] * values[1] < -tolerance and values[2] * values[3] < -tolerance


def _is_self_intersecting(ring: np.ndarray) -> bool:
    count = len(ring)
    for first in range(count):
        a, b = ring[first], ring[(first + 1) % count]
        for second in range(first + 1, count):
            if second in (first, (first + 1) % count) or (second + 1) % count == first:
                continue
            c, d = ring[second], ring[(second + 1) % count]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _simplify(ring: np.ndarray, max_vertices: int) -> np.ndarray:
    contour = ring.astype(np.float32).reshape(-1, 1, 2)
    perimeter = cv2.arcLength(contour, True)
    best = ring
    for ratio in (0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.08):
        approximation = cv2.approxPolyDP(contour, ratio * perimeter, True).reshape(-1, 2)
        if len(approximation) >= 4:
            best = approximation.astype(np.float64)
        if 4 <= len(approximation) <= max_vertices:
            return approximation.astype(np.float64)
    return best


def _is_near_right_angle_quadrilateral(ring: np.ndarray, tolerance_degrees: float = 15.0) -> bool:
    if len(ring) != 4:
        return False
    for index in range(4):
        previous = ring[index - 1] - ring[index]
        following = ring[(index + 1) % 4] - ring[index]
        denominator = np.linalg.norm(previous) * np.linalg.norm(following)
        if denominator <= 1e-9:
            return False
        cosine = float(np.clip(np.dot(previous, following) / denominator, -1.0, 1.0))
        angle = math.degrees(math.acos(cosine))
        if abs(angle - 90.0) > tolerance_degrees:
            return False
    return True


def _rotate(ring: np.ndarray, radians: float) -> np.ndarray:
    cosine, sine = math.cos(radians), math.sin(radians)
    matrix = np.array([[cosine, -sine], [sine, cosine]], dtype=np.float64)
    return ring @ matrix.T


def _edge_axis(first: np.ndarray, second: np.ndarray) -> str:
    delta = second - first
    return "h" if abs(delta[0]) >= abs(delta[1]) else "v"


def _remove_collinear_axis_vertices(ring: np.ndarray) -> np.ndarray:
    points = list(ring)
    changed = True
    while changed and len(points) > 4:
        changed = False
        for index in range(len(points)):
            previous = np.asarray(points[index - 1])
            current = np.asarray(points[index])
            following = np.asarray(points[(index + 1) % len(points)])
            if _edge_axis(previous, current) == _edge_axis(current, following):
                points.pop(index)
                changed = True
                break
    return np.asarray(points, dtype=np.float64)


def _orthogonalize(ring: np.ndarray, angle_degrees: float) -> np.ndarray | None:
    center = ring.mean(axis=0)
    aligned = _rotate(ring - center, math.radians(-angle_degrees))
    aligned = _remove_collinear_axis_vertices(aligned)
    if len(aligned) < 4 or len(aligned) > 8:
        return None

    axes = [_edge_axis(aligned[i], aligned[(i + 1) % len(aligned)]) for i in range(len(aligned))]
    if any(axes[index] == axes[index - 1] for index in range(len(axes))):
        return None
    line_values = []
    for index, axis in enumerate(axes):
        first, second = aligned[index], aligned[(index + 1) % len(aligned)]
        line_values.append(float((first[1] + second[1]) / 2 if axis == "h" else (first[0] + second[0]) / 2))

    snapped = []
    for index in range(len(aligned)):
        previous_axis, current_axis = axes[index - 1], axes[index]
        previous_value, current_value = line_values[index - 1], line_values[index]
        if previous_axis == "v":
            snapped.append((previous_value, current_value))
        else:
            snapped.append((current_value, previous_value))
    return _rotate(np.asarray(snapped), math.radians(angle_degrees)) + center


def _result(candidate: np.ndarray, method: str, original_area: float, fill_ratio: float) -> RegularizationResult:
    candidate_area = abs(_signed_area(candidate))
    if candidate_area <= 1e-9 or _is_self_intersecting(candidate):
        raise ValueError("INVALID_REGULARIZED_RING")
    if _signed_area(candidate) * original_area < 0:
        candidate = candidate[::-1]
    change = abs(candidate_area - abs(original_area)) / max(abs(original_area), 1e-9)
    closed = [tuple(map(float, point)) for point in candidate]
    closed.append(closed[0])
    return RegularizationResult(closed, method, len(candidate), float(change), float(fill_ratio))


def regularize_local_ring(
    points: Sequence[Sequence[float]],
    *,
    rectangle_fill_threshold: float = 0.78,
    max_vertices: int = 8,
    max_area_change_ratio: float = 0.35,
) -> RegularizationResult:
    """Regularize a small planar building ring expressed in metres."""
    ring = _open_ring(points)
    if _is_self_intersecting(ring):
        raise ValueError("SELF_INTERSECTING_RING")
    original_area = _signed_area(ring)
    if abs(original_area) <= 1e-9:
        raise ValueError("DEGENERATE_RING")

    contour = ring.astype(np.float32).reshape(-1, 1, 2)
    rectangle = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rectangle).astype(np.float64)
    box_area = abs(_signed_area(box))
    fill_ratio = abs(original_area) / max(box_area, 1e-9)
    simplified = _simplify(ring, max_vertices)

    if len(simplified) == 4 and not _is_near_right_angle_quadrilateral(simplified):
        candidate, method = simplified, "quadrilateral"
    elif fill_ratio >= rectangle_fill_threshold:
        candidate, method = box, "rectangle"
    elif len(simplified) == 4:
        candidate, method = simplified, "quadrilateral"
    else:
        candidate = _orthogonalize(simplified, rectangle[2])
        method = "orthogonal_complex"
        if candidate is None:
            candidate, method = simplified, "simplified_fallback"

    result = _result(candidate, method, original_area, fill_ratio)
    if result.area_change_ratio > max_area_change_ratio and method != "quadrilateral":
        fallback = _result(simplified, "simplified_fallback", original_area, fill_ratio)
        return fallback
    return result


def regularize_wgs84_ring(points: Sequence[Sequence[float]]) -> RegularizationResult:
    """Regularize a WGS84 ring through a per-building local metre plane."""
    geographic = _open_ring(points)
    center_lon, center_lat = geographic.mean(axis=0)
    metres_per_lon = 111_320.0 * math.cos(math.radians(float(center_lat)))
    metres_per_lat = 110_574.0
    local = np.column_stack((
        (geographic[:, 0] - center_lon) * metres_per_lon,
        (geographic[:, 1] - center_lat) * metres_per_lat,
    ))
    local_result = regularize_local_ring(local)
    local_ring = np.asarray(local_result.ring, dtype=np.float64)
    wgs84_ring = [
        (float(x / metres_per_lon + center_lon), float(y / metres_per_lat + center_lat))
        for x, y in local_ring
    ]
    return RegularizationResult(
        ring=wgs84_ring,
        method=local_result.method,
        vertex_count=local_result.vertex_count,
        area_change_ratio=local_result.area_change_ratio,
        rectangle_fill_ratio=local_result.rectangle_fill_ratio,
    )


def regularize_feature_collection(payload: dict) -> tuple[dict, dict]:
    """Return a regularized copy of a Polygon FeatureCollection and diagnostics."""
    output = copy.deepcopy(payload)
    methods: Counter[str] = Counter()
    original_vertices: Counter[int] = Counter()
    regularized_vertices: Counter[int] = Counter()
    area_changes = []

    for feature in output.get("features", []):
        geometry = feature.get("geometry") or {}
        rings = geometry.get("coordinates") or []
        if geometry.get("type") != "Polygon" or not rings:
            methods["unchanged_unsupported"] += 1
            continue
        ring = rings[0]
        original_count = max(0, len(ring) - 1)
        original_vertices[original_count] += 1
        properties = feature.setdefault("properties", {})
        try:
            result = regularize_wgs84_ring(ring)
        except ValueError as error:
            methods["unchanged_error"] += 1
            regularized_vertices[original_count] += 1
            properties["regularization_experiment"] = "unchanged_error"
            properties["regularization_error"] = str(error)
            continue

        geometry["coordinates"][0] = [[longitude, latitude] for longitude, latitude in result.ring]
        properties.update({
            "original_vertex_count": original_count,
            "regularized_vertex_count": result.vertex_count,
            "regularization_experiment": result.method,
            "regularization_area_change_ratio": result.area_change_ratio,
            "regularization_rectangle_fill_ratio": result.rectangle_fill_ratio,
        })
        methods[result.method] += 1
        regularized_vertices[result.vertex_count] += 1
        area_changes.append(result.area_change_ratio)

    stats = {
        "features": len(output.get("features", [])),
        "methods": dict(sorted(methods.items())),
        "original_vertex_counts": {str(key): value for key, value in sorted(original_vertices.items())},
        "regularized_vertex_counts": {str(key): value for key, value in sorted(regularized_vertices.items())},
        "mean_area_change_ratio": float(np.mean(area_changes)) if area_changes else 0.0,
        "max_area_change_ratio": float(max(area_changes)) if area_changes else 0.0,
    }
    return output, stats
