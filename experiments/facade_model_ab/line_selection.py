from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SelectedLines:
    horizontal: np.ndarray
    vertical: np.ndarray
    accepted_indices: np.ndarray
    rejected_counts: dict[str, int]
    horizontal_inlier_ratio: float
    vertical_inlier_ratio: float


def _axis_angle_deg(segment: np.ndarray) -> float:
    delta = segment[1] - segment[0]
    angle = abs(float(np.degrees(np.arctan2(delta[1], delta[0])))) % 180.0
    return min(angle, 180.0 - angle)


def _mask_support(mask: np.ndarray, segment: np.ndarray, samples: int = 31) -> float:
    height, width = mask.shape[:2]
    points = np.linspace(segment[0], segment[1], samples)
    xs = np.clip(np.rint(points[:, 0] * (width - 1)).astype(int), 0, width - 1)
    ys = np.clip(np.rint(points[:, 1] * (height - 1)).astype(int), 0, height - 1)
    return float(np.count_nonzero(mask[ys, xs])) / float(samples)


def _near_duplicate(left: np.ndarray, right: np.ndarray, distance: float) -> bool:
    direct = np.max(np.linalg.norm(left - right, axis=1))
    reversed_distance = np.max(np.linalg.norm(left - right[::-1], axis=1))
    return float(min(direct, reversed_distance)) <= distance


def _consensus(
    indices: list[int],
    angles: np.ndarray,
    scores: np.ndarray,
    tolerance: float,
) -> tuple[list[int], list[int], float]:
    if not indices:
        return [], [], 0.0
    values = angles[indices]
    order = np.argsort(values)
    sorted_values = values[order]
    sorted_weights = scores[np.asarray(indices)[order]]
    cutoff = float(sorted_weights.sum()) * 0.5
    median = float(sorted_values[np.searchsorted(np.cumsum(sorted_weights), cutoff)])
    kept = [index for index in indices if abs(float(angles[index]) - median) <= tolerance]
    rejected = [index for index in indices if index not in kept]
    return kept, rejected, float(len(kept)) / float(len(indices))


def select_axis_lines(
    segments: np.ndarray,
    scores: np.ndarray,
    *,
    facade_mask: np.ndarray | None = None,
    min_length: float = 0.08,
    min_score: float = 0.20,
    min_mask_support: float = 0.50,
    axis_gate_deg: float = 30.0,
    consensus_angle_deg: float = 8.0,
    duplicate_distance: float = 0.012,
) -> SelectedLines:
    segments = np.asarray(segments, dtype=np.float64)
    scores = np.asarray(scores, dtype=np.float64)
    if segments.ndim != 3 or segments.shape[1:] != (2, 2):
        raise ValueError("segments must have shape [N, 2, 2]")
    if scores.shape != (segments.shape[0],):
        raise ValueError("scores must have shape [N]")
    if not np.isfinite(segments).all() or not np.isfinite(scores).all():
        raise ValueError("segments and scores must be finite")

    rejected: Counter[str] = Counter()
    candidates: list[int] = []
    lengths = np.linalg.norm(segments[:, 1] - segments[:, 0], axis=1)
    for index in range(segments.shape[0]):
        if float(lengths[index]) < min_length:
            rejected["too_short"] += 1
            continue
        if float(scores[index]) < min_score:
            rejected["low_score"] += 1
            continue
        if facade_mask is not None and _mask_support(facade_mask, segments[index]) < min_mask_support:
            rejected["outside_mask"] += 1
            continue
        candidates.append(index)

    kept: list[int] = []
    for index in sorted(candidates, key=lambda item: (-float(scores[item]), item)):
        if any(
            _near_duplicate(segments[index], segments[other], duplicate_distance)
            for other in kept
        ):
            rejected["duplicate"] += 1
        else:
            kept.append(index)
    kept.sort()

    angles = np.array([_axis_angle_deg(segment) for segment in segments])
    horizontal_candidates: list[int] = []
    vertical_candidates: list[int] = []
    for index in kept:
        angle = float(angles[index])
        if angle <= axis_gate_deg:
            horizontal_candidates.append(index)
        elif angle >= 90.0 - axis_gate_deg:
            vertical_candidates.append(index)
        else:
            rejected["direction_outlier"] += 1

    horizontal, rejected_horizontal, horizontal_ratio = _consensus(
        horizontal_candidates, angles, scores, consensus_angle_deg
    )
    vertical_deviation = np.abs(90.0 - angles)
    vertical, rejected_vertical, vertical_ratio = _consensus(
        vertical_candidates, vertical_deviation, scores, consensus_angle_deg
    )
    direction_outliers = len(rejected_horizontal) + len(rejected_vertical)
    if direction_outliers:
        rejected["direction_outlier"] += direction_outliers
    accepted = sorted(horizontal + vertical)
    return SelectedLines(
        horizontal=segments[horizontal],
        vertical=segments[vertical],
        accepted_indices=np.asarray(accepted, dtype=np.int64),
        rejected_counts=dict(rejected),
        horizontal_inlier_ratio=horizontal_ratio,
        vertical_inlier_ratio=vertical_ratio,
    )
