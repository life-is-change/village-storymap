from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

from rural_house_generator.backend.app.facade.perspective import order_corners


@dataclass(frozen=True)
class InpaintDecision:
    accepted: bool
    reason: str
    area_ratio: float


@dataclass(frozen=True)
class PlaneSpec:
    name: str
    source_quad: NDArray[np.floating]
    destination_box: tuple[float, float, float, float]


@dataclass(frozen=True)
class PlaneAtlasResult:
    rgba: NDArray[np.uint8]
    preview: NDArray[np.uint8]
    mask: NDArray[np.uint8]
    plane_boxes: tuple[tuple[int, int, int, int], ...]
    resample_passes: int


def decide_inpaint(
    mask: NDArray[np.uint8],
    target_area: int,
    max_area_ratio: float = 0.08,
) -> InpaintDecision:
    if mask.ndim != 2:
        raise ValueError("mask must be a single-channel image")
    if target_area <= 0:
        raise ValueError("target_area must be positive")
    selected = mask > 0
    area = int(selected.sum())
    ratio = area / target_area
    if area == 0:
        return InpaintDecision(False, "empty-mask", ratio)
    if ratio > max_area_ratio:
        return InpaintDecision(False, "mask-too-large", ratio)
    if (
        selected[0].any()
        or selected[-1].any()
        or selected[:, 0].any()
        or selected[:, -1].any()
    ):
        return InpaintDecision(False, "touches-image-border", ratio)
    return InpaintDecision(True, "accepted", ratio)


def select_intersecting_safe_components(
    mask: NDArray[np.uint8],
    target_mask: NDArray[np.uint8],
    max_component_ratio: float = 0.08,
) -> NDArray[np.uint8]:
    if mask.ndim != 2 or target_mask.shape != mask.shape:
        raise ValueError("mask and target_mask must be same-sized single-channel images")
    target_area = int((target_mask > 0).sum())
    if target_area <= 0:
        raise ValueError("target_mask must contain selected pixels")
    count, labels = cv2.connectedComponents((mask > 0).astype(np.uint8), connectivity=8)
    selected = np.zeros_like(mask, dtype=np.uint8)
    for label in range(1, count):
        component = labels == label
        if not np.any(component & (target_mask > 0)):
            continue
        if int(component.sum()) / target_area > max_component_ratio:
            continue
        if component[0].any() or component[-1].any() or component[:, 0].any() or component[:, -1].any():
            continue
        selected[component] = 255
    return selected


def _pixel_box(
    box: tuple[float, float, float, float], width: int, height: int
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise ValueError("destination_box must be ordered within normalized bounds")
    x0 = int(round(left * width))
    y0 = int(round(top * height))
    x1 = int(round(right * width))
    y1 = int(round(bottom * height))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ValueError("destination plane must be at least two pixels wide and high")
    return x0, y0, x1, y1


def render_plane_atlas(
    image: NDArray[np.uint8],
    planes: Sequence[PlaneSpec],
    output_size: tuple[int, int],
    background: tuple[int, int, int] = (238, 238, 238),
) -> PlaneAtlasResult:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    if not planes:
        raise ValueError("at least one facade plane is required")
    width, height = map(int, output_size)
    if width < 2 or height < 2:
        raise ValueError("output_size must be at least two by two")

    canvas = np.full((height, width, 3), background, dtype=np.uint8)
    mask = np.zeros((height, width), dtype=np.uint8)
    boxes: list[tuple[int, int, int, int]] = []
    for plane in planes:
        source = order_corners(np.asarray(plane.source_quad, dtype=np.float32))
        x0, y0, x1, y1 = _pixel_box(plane.destination_box, width, height)
        destination = np.float32(
            [[0, 0], [x1 - x0 - 1, 0], [x1 - x0 - 1, y1 - y0 - 1], [0, y1 - y0 - 1]]
        )
        transform = cv2.getPerspectiveTransform(source, destination)
        rectified = cv2.warpPerspective(
            image,
            transform,
            (x1 - x0, y1 - y0),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        canvas[y0:y1, x0:x1] = rectified
        mask[y0:y1, x0:x1] = 255
        boxes.append((x0, y0, x1, y1))

    ys, xs = np.where(mask > 0)
    if not len(xs):
        raise ValueError("facade planes produced an empty atlas")
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    canvas = canvas[top:bottom, left:right]
    mask = mask[top:bottom, left:right]
    alpha = mask[..., None]
    rgba = np.dstack((canvas, alpha))
    cropped_boxes = tuple(
        (x0 - left, y0 - top, x1 - left, y1 - top) for x0, y0, x1, y1 in boxes
    )
    return PlaneAtlasResult(
        rgba=rgba,
        preview=canvas,
        mask=mask,
        plane_boxes=cropped_boxes,
        resample_passes=len(planes),
    )
