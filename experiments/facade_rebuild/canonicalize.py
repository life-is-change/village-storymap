from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class FloorBand:
    index: int
    top: int
    bottom: int


@dataclass(frozen=True)
class Opening:
    left: int
    top: int
    right: int
    bottom: int


def build_floor_bands(height: int, floors: int) -> tuple[FloorBand, ...]:
    if height < 20:
        raise ValueError("height must be at least 20 pixels")
    if floors < 1 or floors > 12:
        raise ValueError("floors must be between 1 and 12")

    facade_top = int(round(height * 0.09))
    facade_bottom = int(round(height * 0.90))
    boundaries = np.rint(
        np.linspace(facade_top, facade_bottom, floors + 1)
    ).astype(int)
    return tuple(
        FloorBand(index=index, top=int(boundaries[index]), bottom=int(boundaries[index + 1]))
        for index in range(floors)
    )


def detect_source_floor_bands(
    image: NDArray[np.uint8],
    floors: int,
) -> tuple[FloorBand, ...]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    if floors < 1 or floors > 12:
        raise ValueError("floors must be between 1 and 12")
    height = image.shape[0]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    vertical_gradient = np.mean(
        np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)), axis=1
    )
    window = max(7, int(round(height * 0.02)))
    if window % 2 == 0:
        window += 1
    energy = np.convolve(vertical_gradient, np.ones(window) / window, mode="same")

    top = int(round(height * 0.04))
    bottom_low = int(round(height * 0.84))
    bottom_high = min(height - 1, int(round(height * 0.96)))
    bottom = bottom_low + int(np.argmax(energy[bottom_low : bottom_high + 1]))
    boundaries = [top]
    search_radius = max(12, int(round(height * 0.11)))
    for index in range(1, floors):
        expected = int(round(top + (bottom - top) * index / floors))
        low = max(boundaries[-1] + 8, expected - search_radius)
        high = min(bottom - 8, expected + search_radius)
        boundary = low + int(np.argmax(energy[low : high + 1]))
        boundaries.append(boundary)
    boundaries.append(bottom)
    return tuple(
        FloorBand(index=index, top=boundaries[index], bottom=boundaries[index + 1])
        for index in range(floors)
    )


def regularize_floor_pixels(
    image: NDArray[np.uint8],
    floors: int,
    source_bands: tuple[FloorBand, ...] | None = None,
) -> NDArray[np.uint8]:
    """Equalize floor heights while preserving the source photograph pixels."""
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    bands = source_bands or detect_source_floor_bands(image, floors)
    if len(bands) != floors:
        raise ValueError("source_bands must match floors")
    if any(band.bottom <= band.top for band in bands):
        raise ValueError("source floor bands must have positive height")

    result = image.copy()
    top = bands[0].top
    bottom = bands[-1].bottom
    targets = np.rint(np.linspace(top, bottom, floors + 1)).astype(int)
    width = image.shape[1]
    for index, band in enumerate(bands):
        destination_top = int(targets[index])
        destination_bottom = int(targets[index + 1])
        source = image[band.top : band.bottom]
        interpolation = (
            cv2.INTER_AREA
            if destination_bottom - destination_top < band.bottom - band.top
            else cv2.INTER_LINEAR
        )
        result[destination_top:destination_bottom] = cv2.resize(
            source,
            (width, destination_bottom - destination_top),
            interpolation=interpolation,
        )
    return result


def detect_openings(
    image: NDArray[np.uint8],
    band: FloorBand,
) -> tuple[Opening, ...]:
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must be a BGR image")
    height, width = image.shape[:2]
    top = max(0, min(height - 1, band.top))
    bottom = max(top + 1, min(height, band.bottom))
    crop = image[top:bottom]

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    kernel_size = max(5, int(round(min(width, bottom - top) * 0.035)))
    if kernel_size % 2 == 0:
        kernel_size += 1
    candidates: list[Opening] = []
    min_width = width * 0.05
    min_height = (bottom - top) * 0.14
    min_area = width * (bottom - top) * 0.0035
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
    for threshold in (125, 170):
        dark = cv2.inRange(gray, 0, threshold)
        cleaned = cv2.morphologyEx(dark, cv2.MORPH_OPEN, kernel)
        count, _, stats, _ = cv2.connectedComponentsWithStats(cleaned, connectivity=8)
        for label in range(1, count):
            x, y, component_width, component_height, area = stats[label]
            if (
                component_width < min_width
                or component_height < min_height
                or area < min_area
            ):
                continue
            if x <= 2 or x + component_width >= width - 2:
                continue
            touches_upper_edge = y < (bottom - top) * 0.06
            looks_like_edge_structure = (
                component_width > width * 0.25
                or x < width * 0.05
                or x + component_width > width * 0.95
            )
            if touches_upper_edge and looks_like_edge_structure:
                continue
            candidates.append(
                Opening(
                    left=int(x),
                    top=int(top + y),
                    right=int(x + component_width),
                    bottom=int(top + y + component_height),
                )
            )

    merged: list[Opening] = []
    for candidate in sorted(
        candidates,
        key=lambda item: (item.right - item.left) * (item.bottom - item.top),
        reverse=True,
    ):
        combined = False
        for index, existing in enumerate(merged):
            overlap_width = max(0, min(candidate.right, existing.right) - max(candidate.left, existing.left))
            overlap_height = max(0, min(candidate.bottom, existing.bottom) - max(candidate.top, existing.top))
            overlap = overlap_width * overlap_height
            candidate_area = (candidate.right - candidate.left) * (candidate.bottom - candidate.top)
            existing_area = (existing.right - existing.left) * (existing.bottom - existing.top)
            if overlap >= min(candidate_area, existing_area) * 0.55:
                merged[index] = Opening(
                    left=min(candidate.left, existing.left),
                    top=min(candidate.top, existing.top),
                    right=max(candidate.right, existing.right),
                    bottom=max(candidate.bottom, existing.bottom),
                )
                combined = True
                break
        if not combined:
            merged.append(candidate)
    return tuple(sorted(merged, key=lambda item: item.left))


def _sample_wall_color(image: NDArray[np.uint8]) -> tuple[int, int, int]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    eligible = (gray >= 155) & (hsv[:, :, 1] <= 85)
    pixels = image[eligible]
    if pixels.size == 0:
        return 232, 232, 232
    median = np.median(pixels, axis=0)
    softened = np.clip(median * 0.55 + 255 * 0.45, 205, 246).astype(np.uint8)
    return tuple(int(channel) for channel in softened)


def _draw_roof(
    canvas: NDArray[np.uint8],
    left: int,
    right: int,
    top: int,
    bottom: int,
) -> None:
    cv2.rectangle(canvas, (left, top), (right, bottom), (78, 72, 70), thickness=-1)
    tile_width = max(8, (right - left) // 45)
    for row, y in enumerate(range(top + 3, bottom, max(5, tile_width // 2))):
        offset = tile_width // 2 if row % 2 else 0
        for x in range(left - tile_width + offset, right + tile_width, tile_width):
            cv2.ellipse(
                canvas,
                (x, y),
                (max(3, tile_width // 2), max(2, tile_width // 4)),
                0,
                0,
                180,
                (32, 30, 30),
                thickness=1,
                lineType=cv2.LINE_AA,
            )
    cv2.line(canvas, (left, bottom), (right, bottom), (45, 43, 43), thickness=3)


def _draw_opening(
    canvas: NDArray[np.uint8],
    opening: Opening,
    source_band: FloorBand,
    target_band: FloorBand,
    facade_left: int,
    facade_right: int,
) -> None:
    width = canvas.shape[1]
    usable_width = facade_right - facade_left
    x0 = facade_left + int(round(opening.left / width * usable_width))
    x1 = facade_left + int(round(opening.right / width * usable_width))
    source_height = source_band.bottom - source_band.top
    target_height = target_band.bottom - target_band.top
    source_top = (opening.top - source_band.top) / max(1, source_height)
    source_bottom = (opening.bottom - source_band.top) / max(1, source_height)
    y0 = target_band.top + int(round(max(0.24, source_top) * target_height))
    y1 = target_band.top + int(round(min(0.86, source_bottom) * target_height))
    if x1 - x0 < 12 or y1 - y0 < 16:
        return

    frame = max(3, int(round(min(canvas.shape[:2]) * 0.007)))
    cv2.rectangle(canvas, (x0 - frame, y0 - frame), (x1 + frame, y1 + frame), (145, 148, 146), -1)
    cv2.rectangle(canvas, (x0, y0), (x1, y1), (48, 61, 59), -1)
    cv2.line(canvas, ((x0 + x1) // 2, y0), ((x0 + x1) // 2, y1), (165, 172, 167), 2)
    cv2.line(canvas, (x0, (y0 + y1) // 2), (x1, (y0 + y1) // 2), (165, 172, 167), 2)


def _draw_balcony_rail(
    canvas: NDArray[np.uint8],
    band: FloorBand,
    left: int,
    right: int,
) -> None:
    band_height = band.bottom - band.top
    rail_top = band.top + int(round(band_height * 0.20))
    rail_bottom = band.bottom - int(round(band_height * 0.09))
    rail_color = (54, 54, 54)
    cv2.line(canvas, (left, rail_top), (right, rail_top), rail_color, thickness=3)
    cv2.line(canvas, (left, rail_bottom), (right, rail_bottom), rail_color, thickness=4)
    spacing = max(12, (right - left) // 48)
    for x in range(left, right + 1, spacing):
        cv2.line(canvas, (x, rail_top), (x, rail_bottom), rail_color, thickness=2)
    cv2.line(
        canvas,
        (left, rail_top + (rail_bottom - rail_top) // 2),
        (right, rail_top + (rail_bottom - rail_top) // 2),
        (78, 78, 78),
        thickness=1,
    )


def render_canonical_facade(
    rectified: NDArray[np.uint8],
    floors: int,
) -> NDArray[np.uint8]:
    if rectified.ndim != 3 or rectified.shape[2] != 3:
        raise ValueError("rectified must be a BGR image")
    height, width = rectified.shape[:2]
    if height < 80 or width < 80:
        raise ValueError("rectified image is too small")

    canvas = np.full_like(rectified, 255)
    facade_left = int(round(width * 0.055))
    facade_right = int(round(width * 0.945))
    bands = build_floor_bands(height, floors)
    source_bands = detect_source_floor_bands(rectified, floors)
    wall_color = _sample_wall_color(rectified)

    roof_top = int(round(height * 0.025))
    _draw_roof(canvas, facade_left, facade_right, roof_top, bands[0].top - 2)

    for band, source_band in zip(bands, source_bands):
        cv2.rectangle(
            canvas,
            (facade_left, band.top),
            (facade_right, band.bottom),
            wall_color,
            thickness=-1,
        )
        for opening in detect_openings(rectified, source_band)[:7]:
            _draw_opening(
                canvas,
                opening,
                source_band,
                band,
                facade_left,
                facade_right,
            )

        if band.index < floors - 1:
            _draw_balcony_rail(canvas, band, facade_left - 4, facade_right + 4)
        else:
            for fraction in (0.28, 0.56, 0.82):
                x = facade_left + int(round((facade_right - facade_left) * fraction))
                cv2.rectangle(
                    canvas,
                    (x - 3, band.top + 3),
                    (x + 3, band.bottom - 2),
                    (166, 164, 158),
                    thickness=-1,
                )

        cv2.line(
            canvas,
            (facade_left - 4, band.bottom),
            (facade_right + 4, band.bottom),
            (95, 95, 92),
            thickness=4,
        )

    base_top = bands[-1].bottom
    base_bottom = min(height - 1, int(round(height * 0.98)))
    cv2.rectangle(canvas, (facade_left, base_top), (facade_right, base_bottom), (82, 83, 82), -1)
    brick_height = max(5, (base_bottom - base_top) // 6)
    brick_width = max(18, (facade_right - facade_left) // 22)
    for row, y in enumerate(range(base_top, base_bottom, brick_height)):
        offset = brick_width // 2 if row % 2 else 0
        cv2.line(canvas, (facade_left, y), (facade_right, y), (184, 184, 180), 1)
        for x in range(facade_left - brick_width + offset, facade_right, brick_width):
            cv2.line(canvas, (x, y), (x, min(y + brick_height, base_bottom)), (184, 184, 180), 1)

    return canvas
