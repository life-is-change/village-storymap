from __future__ import annotations

import cv2
import numpy as np

from rural_house_generator.backend.app.roof_analysis import (
    analyze_roof,
    classify_roof_type,
)


CANVAS_HEIGHT = 420
CANVAS_WIDTH = 720
ROOF_BASE_Y = 190


def synthetic_roof(
    polygon: list[tuple[int, int]],
    bgr: tuple[int, int, int],
    *,
    granular: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    image = np.full((CANVAS_HEIGHT, CANVAS_WIDTH, 3), 238, np.uint8)
    mask = np.zeros((CANVAS_HEIGHT, CANVAS_WIDTH), np.uint8)
    points = np.asarray(polygon, dtype=np.int32)
    cv2.fillPoly(image, [points], bgr)
    cv2.fillPoly(mask, [points], 255)
    cv2.rectangle(
        mask,
        (min(x for x, _ in polygon), ROOF_BASE_Y),
        (max(x for x, _ in polygon), CANVAS_HEIGHT - 1),
        255,
        -1,
    )
    if granular:
        noise = np.random.default_rng(7).integers(
            -38, 39, image.shape[:2], dtype=np.int16
        )
        roof_pixels = np.zeros_like(mask)
        cv2.fillPoly(roof_pixels, [points], 255)
        for channel in range(3):
            values = image[:, :, channel].astype(np.int16)
            values[roof_pixels > 0] += noise[roof_pixels > 0]
            image[:, :, channel] = np.clip(values, 0, 255).astype(np.uint8)
    return image, mask


def roof_top_norm() -> float:
    return ROOF_BASE_Y / (CANVAS_HEIGHT - 1)


def test_analyze_roof_recognizes_red_gable_and_high_pitch() -> None:
    image, mask = synthetic_roof(
        [(120, ROOF_BASE_Y), (360, 18), (600, ROOF_BASE_Y)],
        (48, 82, 188),
    )

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["type"]["value"] == "gable"
    assert result["pitch"]["value"] == "high"
    assert result["material"]["value"] == "terracotta_tile"
    assert all(
        result[key]["source"] == "automatic"
        for key in ("type", "pitch", "material")
    )


def test_analyze_roof_recognizes_blue_gray_hip_and_standard_pitch() -> None:
    image, mask = synthetic_roof(
        [
            (110, ROOF_BASE_Y),
            (220, 135),
            (500, 135),
            (610, ROOF_BASE_Y),
        ],
        (92, 82, 72),
    )

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["type"]["value"] == "hip"
    assert result["pitch"]["value"] == "standard"
    assert result["material"]["value"] == "gray_tile"


def test_analyze_roof_recognizes_flat_silhouette() -> None:
    image, mask = synthetic_roof(
        [
            (120, ROOF_BASE_Y),
            (120, 165),
            (600, 165),
            (600, ROOF_BASE_Y),
        ],
        (105, 108, 112),
    )

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["type"]["value"] == "flat"
    assert result["pitch"]["value"] == "low"


def test_analyze_roof_keeps_shallow_sloped_eaves_as_hip_roof() -> None:
    image, mask = synthetic_roof(
        [
            (100, ROOF_BASE_Y),
            (240, 155),
            (480, 155),
            (620, ROOF_BASE_Y),
        ],
        (78, 80, 84),
    )

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["type"]["value"] == "hip"
    assert result["pitch"]["value"] == "low"


def test_classify_roof_type_uses_short_top_plateau_as_slope_evidence() -> None:
    silhouette = {
        "height": 70.0,
        "width": 1305.0,
        "plateau_fraction": 0.17,
        "column_coverage": 1.0,
    }

    result = classify_roof_type(silhouette, lines=[])

    assert result["value"] == "gable"


def test_analyze_roof_uses_texture_variation_for_dark_asphalt() -> None:
    image, mask = synthetic_roof(
        [
            (110, ROOF_BASE_Y),
            (220, 135),
            (500, 135),
            (610, ROOF_BASE_Y),
        ],
        (55, 58, 61),
        granular=True,
    )

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["material"]["value"] == "asphalt_shingle"


def test_analyze_roof_uses_safe_defaults_when_effective_region_is_too_small() -> None:
    image = np.full((240, 360, 3), 245, np.uint8)

    result = analyze_roof(image, roof_top_norm=0.04)

    assert [
        result[key]["value"] for key in ("type", "material", "pitch")
    ] == ["hip", "gray_tile", "standard"]
    assert all(
        result[key]["source"] == "fallback"
        for key in ("type", "material", "pitch")
    )
    assert result["warnings"] == ["roof_region_unclear"]
    assert result["detected_features"] == []


def test_analyze_roof_does_not_invent_features_from_occluded_roof() -> None:
    image, mask = synthetic_roof(
        [(120, ROOF_BASE_Y), (360, 35), (600, ROOF_BASE_Y)],
        (75, 78, 82),
    )
    cv2.rectangle(image, (250, 0), (470, ROOF_BASE_Y), (25, 110, 35), -1)
    cv2.rectangle(mask, (250, 0), (470, ROOF_BASE_Y), 0, -1)

    result = analyze_roof(image, roof_top_norm(), building_mask=mask)

    assert result["detected_features"] == []
