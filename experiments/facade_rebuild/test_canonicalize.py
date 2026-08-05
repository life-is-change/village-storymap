from __future__ import annotations

import cv2
import numpy as np

from experiments.facade_rebuild.canonicalize import (
    FloorBand,
    build_floor_bands,
    detect_source_floor_bands,
    detect_openings,
    regularize_floor_pixels,
    render_canonical_facade,
)


def test_build_floor_bands_reserves_roof_and_base_without_overlap():
    bands = build_floor_bands(height=1000, floors=3)

    assert [(band.top, band.bottom) for band in bands] == [
        (90, 360),
        (360, 630),
        (630, 900),
    ]
    assert all(left.bottom == right.top for left, right in zip(bands, bands[1:]))


def test_detect_openings_ignores_thin_railings_and_keeps_broad_rectangles():
    image = np.full((300, 600, 3), 235, dtype=np.uint8)
    cv2.rectangle(image, (90, 90), (190, 220), (35, 35, 35), thickness=-1)
    cv2.rectangle(image, (315, 105), (500, 220), (55, 55, 55), thickness=-1)
    for x in range(25, 576, 22):
        cv2.line(image, (x, 55), (x, 245), (20, 20, 20), thickness=2)
    cv2.line(image, (20, 55), (580, 55), (20, 20, 20), thickness=3)
    cv2.line(image, (20, 245), (580, 245), (20, 20, 20), thickness=3)

    openings = detect_openings(image, FloorBand(index=0, top=40, bottom=260))

    assert len(openings) == 2
    assert openings[0].left <= 95
    assert openings[0].right >= 185
    assert openings[1].left <= 320
    assert openings[1].right >= 495


def test_detect_source_floor_bands_follows_displaced_horizontal_separators():
    image = np.full((1000, 600, 3), 230, dtype=np.uint8)
    for y in (260, 570, 910):
        cv2.line(image, (20, y), (580, y), (25, 25, 25), thickness=12)

    bands = detect_source_floor_bands(image, floors=3)

    assert abs(bands[0].bottom - 260) <= 12
    assert abs(bands[1].bottom - 570) <= 12
    assert abs(bands[2].bottom - 910) <= 18


def test_detect_openings_merges_nested_frame_and_inner_panel():
    image = np.full((320, 600, 3), 235, dtype=np.uint8)
    cv2.rectangle(image, (170, 55), (430, 275), (30, 30, 30), thickness=18)
    cv2.rectangle(image, (220, 95), (385, 245), (45, 45, 45), thickness=-1)

    openings = detect_openings(image, FloorBand(index=0, top=30, bottom=290))

    assert len(openings) == 1
    assert openings[0].left <= 175
    assert openings[0].right >= 425


def test_detect_openings_keeps_sunlit_medium_gray_opening():
    image = np.full((300, 600, 3), 238, dtype=np.uint8)
    cv2.rectangle(image, (185, 90), (410, 235), (155, 155, 155), thickness=-1)

    openings = detect_openings(image, FloorBand(index=1, top=40, bottom=270))

    assert len(openings) == 1
    assert openings[0].left <= 190
    assert openings[0].right >= 405


def test_render_canonical_facade_has_margins_slabs_and_upper_balconies():
    rectified = np.full((600, 480, 3), 230, dtype=np.uint8)

    rendered = render_canonical_facade(rectified, floors=3)

    assert rendered.shape == rectified.shape
    np.testing.assert_array_equal(rendered[0, 0], np.array([255, 255, 255]))

    bands = build_floor_bands(height=600, floors=3)
    facade_left = round(480 * 0.055)
    facade_right = round(480 * 0.945)
    for boundary in (bands[0].bottom, bands[1].bottom, bands[2].bottom):
        slab_strip = rendered[boundary - 2 : boundary + 3, facade_left:facade_right]
        assert float(slab_strip.mean()) < 205

    gray = cv2.cvtColor(rendered, cv2.COLOR_BGR2GRAY)
    upper_balcony = gray[bands[0].top + 35 : bands[0].bottom - 18, facade_left:facade_right]
    ground_wall = gray[bands[2].top + 35 : bands[2].bottom - 18, facade_left:facade_right]
    upper_dark_ratio = float((upper_balcony < 100).mean())
    ground_dark_ratio = float((ground_wall < 100).mean())
    assert upper_dark_ratio > ground_dark_ratio * 2.0


def test_regularize_floor_pixels_preserves_source_photo_colors():
    image = np.zeros((1000, 240, 3), dtype=np.uint8)
    image[:80] = (80, 80, 80)
    image[80:260] = (20, 40, 210)
    image[260:570] = (30, 190, 50)
    image[570:910] = (210, 70, 30)
    image[910:] = (120, 120, 120)
    source_bands = (
        FloorBand(index=0, top=80, bottom=260),
        FloorBand(index=1, top=260, bottom=570),
        FloorBand(index=2, top=570, bottom=910),
    )

    result = regularize_floor_pixels(image, floors=3, source_bands=source_bands)

    np.testing.assert_array_equal(result[150, 120], np.array([20, 40, 210]))
    np.testing.assert_array_equal(result[480, 120], np.array([30, 190, 50]))
    np.testing.assert_array_equal(result[800, 120], np.array([210, 70, 30]))
    np.testing.assert_array_equal(result[40, 120], image[40, 120])
    np.testing.assert_array_equal(result[950, 120], image[950, 120])
