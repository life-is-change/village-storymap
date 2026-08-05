from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class StructuralEnvelopeResult:
    envelope: NDArray[np.float32]
    member_indices: tuple[int, ...]
    rejected_scene_indices: tuple[int, ...]
    component_indices: tuple[tuple[int, ...], ...]


def _vertically_related(
    first: NDArray[np.float32],
    second: NDArray[np.float32],
    image_height: int,
) -> bool:
    first_width = float(first[2] - first[0])
    second_width = float(second[2] - second[0])
    overlap = max(0.0, min(float(first[2]), float(second[2])) - max(float(first[0]), float(second[0])))
    if overlap / max(1.0, min(first_width, second_width)) < 0.45:
        return False
    vertical_gap = max(0.0, max(float(first[1]), float(second[1])) - min(float(first[3]), float(second[3])))
    return vertical_gap <= image_height * 0.15


def merge_target_building_boxes(
    boxes: NDArray[np.floating],
    scores: NDArray[np.floating],
    image_shape: tuple[int, int],
    max_scene_area_ratio: float = 0.30,
) -> StructuralEnvelopeResult:
    values = np.asarray(boxes, dtype=np.float32)
    confidence = np.asarray(scores, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] != 4 or confidence.shape != (len(values),):
        raise ValueError("boxes must be N by 4 and scores must contain N values")
    height, width = map(int, image_shape)
    if height < 2 or width < 2 or not len(values):
        raise ValueError("image_shape and boxes must be non-empty")
    sizes = values[:, 2:4] - values[:, 0:2]
    if (sizes <= 0).any() or not np.isfinite(values).all():
        raise ValueError("boxes must be finite and ordered")

    ratios = sizes[:, 0] * sizes[:, 1] / float(width * height)
    oversize = [int(index) for index in np.flatnonzero(ratios > max_scene_area_ratio)]
    accepted = [int(index) for index in np.flatnonzero(ratios <= max_scene_area_ratio)]
    if not accepted:
        raise ValueError("all boxes are scene-sized")

    neighbors = {index: set() for index in accepted}
    for offset, first_index in enumerate(accepted):
        for second_index in accepted[offset + 1 :]:
            if _vertically_related(values[first_index], values[second_index], height):
                neighbors[first_index].add(second_index)
                neighbors[second_index].add(first_index)

    components: list[tuple[int, ...]] = []
    remaining = set(accepted)
    while remaining:
        root = min(remaining)
        stack = [root]
        members = set()
        while stack:
            current = stack.pop()
            if current in members:
                continue
            members.add(current)
            stack.extend(neighbors[current] - members)
        remaining -= members
        components.append(tuple(sorted(members)))

    def component_envelope(component: tuple[int, ...]) -> NDArray[np.float32]:
        subset = values[list(component)]
        return np.float32(
            [subset[:, 0].min(), subset[:, 1].min(), subset[:, 2].max(), subset[:, 3].max()]
        )

    def centrality(component: tuple[int, ...]) -> tuple[float, float]:
        envelope = component_envelope(component)
        center_x = float(envelope[0] + envelope[2]) * 0.5 / width
        center_y = float(envelope[1] + envelope[3]) * 0.5 / height
        distance = abs(center_x - 0.5) * 2.0 + abs(center_y - 0.55) * 0.35
        return distance, -float(confidence[list(component)].sum())

    selected = min(components, key=centrality)
    core = component_envelope(selected)
    core_width = float(core[2] - core[0])
    aligned_completion: list[int] = []
    for index in oversize:
        candidate = values[index]
        overlap = max(0.0, min(float(core[2]), float(candidate[2])) - max(float(core[0]), float(candidate[0])))
        left_expansion = max(0.0, float(core[0] - candidate[0])) / width
        right_expansion = max(0.0, float(candidate[2] - core[2])) / width
        if (
            ratios[index] <= 0.65
            and overlap / max(1.0, core_width) >= 0.90
            and left_expansion <= 0.04
            and right_expansion <= 0.04
        ):
            aligned_completion.append(index)
    selected = tuple(sorted((*selected, *aligned_completion)))
    rejected = tuple(index for index in oversize if index not in aligned_completion)
    return StructuralEnvelopeResult(
        envelope=component_envelope(selected),
        member_indices=selected,
        rejected_scene_indices=rejected,
        component_indices=tuple(components),
    )
