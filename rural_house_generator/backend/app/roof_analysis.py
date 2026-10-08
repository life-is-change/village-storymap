from __future__ import annotations

import math

import cv2
import numpy as np


SAFE_VALUES = {
    "type": "hip",
    "material": "gray_tile",
    "pitch": "standard",
}
MIN_EFFECTIVE_PIXELS = 800
MIN_CONFIDENCE = 0.55


def decision(
    value: str, confidence: float, source: str = "automatic"
) -> dict[str, object]:
    return {
        "value": value,
        "confidence": round(float(np.clip(confidence, 0.0, 1.0)), 3),
        "source": source,
    }


def fallback_roof_analysis(roof_top_norm: float) -> dict[str, object]:
    return {
        key: decision(value, 0.0, "fallback")
        for key, value in SAFE_VALUES.items()
    } | {
        "crop_top": round(float(np.clip(roof_top_norm, 0.0, 0.65)), 6),
        "warnings": ["roof_region_unclear"],
        "detected_features": [],
    }


def _largest_component(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        return np.zeros_like(mask)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == largest, 255, 0).astype(np.uint8)


def _candidate_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    candidate = np.where(
        (gray < 226) | ((hsv[:, :, 1] > 42) & (hsv[:, :, 2] < 235)),
        255,
        0,
    ).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN, kernel)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, kernel, iterations=2)
    return _largest_component(candidate)


def extract_roof_region(
    image: np.ndarray,
    crop_y: int,
    building_mask: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray]:
    crop_y = max(0, min(int(crop_y), image.shape[0] - 1))
    roi = np.ascontiguousarray(image[: crop_y + 1])
    if building_mask is None:
        roi_mask = _candidate_mask(roi)
    else:
        mask = building_mask
        if mask.ndim == 3:
            mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
        if mask.shape[:2] != image.shape[:2]:
            mask = cv2.resize(
                mask,
                (image.shape[1], image.shape[0]),
                interpolation=cv2.INTER_NEAREST,
            )
        roi_mask = np.where(mask[: crop_y + 1] > 127, 255, 0).astype(np.uint8)
    return roi, _largest_component(roi_mask)


def roof_silhouette(mask: np.ndarray) -> dict[str, object] | None:
    ys, xs = np.where(mask > 0)
    if xs.size == 0:
        return None
    x_min, x_max = int(xs.min()), int(xs.max())
    columns = np.arange(x_min, x_max + 1)
    top = np.full(columns.shape, np.nan, dtype=np.float32)
    for index, x in enumerate(columns):
        column_y = np.flatnonzero(mask[:, x] > 0)
        if column_y.size:
            top[index] = float(column_y.min())
    valid = np.isfinite(top)
    if valid.mean() < 0.68:
        return None
    valid_x = columns[valid]
    valid_top = top[valid]
    base_y = float(ys.max())
    min_y = float(valid_top.min())
    height = max(1.0, base_y - min_y)
    width = max(1.0, float(x_max - x_min))
    plateau_limit = min_y + max(2.0, height * 0.08)
    plateau_x = valid_x[valid_top <= plateau_limit]
    return {
        "x_min": float(x_min),
        "x_max": float(x_max),
        "base_y": base_y,
        "min_y": min_y,
        "height": height,
        "width": width,
        "plateau_left": float(plateau_x.min()),
        "plateau_right": float(plateau_x.max()),
        "plateau_fraction": float((plateau_x.max() - plateau_x.min() + 1) / width),
        "column_coverage": float(valid.mean()),
    }


def dominant_roof_lines(image: np.ndarray, mask: np.ndarray) -> list[float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 45, 135)
    edges[mask == 0] = 0
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180.0,
        threshold=24,
        minLineLength=max(24, image.shape[1] // 18),
        maxLineGap=12,
    )
    if lines is None:
        return []
    angles: list[float] = []
    for x1, y1, x2, y2 in lines[:, 0]:
        angle = abs(math.degrees(math.atan2(float(y2 - y1), float(x2 - x1))))
        angle = min(angle, 180.0 - angle)
        if 5.0 <= angle <= 75.0:
            angles.append(angle)
    return angles


def classify_roof_type(
    silhouette: dict[str, object] | None,
    lines: list[float],
) -> dict[str, object]:
    if silhouette is None:
        return decision("hip", 0.0)
    height_ratio = float(silhouette["height"]) / float(silhouette["width"])
    plateau_fraction = float(silhouette["plateau_fraction"])
    coverage = float(silhouette["column_coverage"])
    stable_sloped_lines = [angle for angle in lines if 7.0 <= angle <= 60.0]
    broad_level_top = plateau_fraction >= 0.65
    if height_ratio < 0.10 and broad_level_top and not stable_sloped_lines:
        return decision("flat", min(0.96, 0.72 + coverage * 0.22))
    if plateau_fraction < 0.18:
        confidence = 0.66 + min(0.25, height_ratio * 0.75)
        return decision("gable", confidence)
    line_bonus = 0.08 if stable_sloped_lines else 0.0
    return decision("hip", min(0.94, 0.72 + line_bonus + coverage * 0.12))


def classify_roof_pitch(
    silhouette: dict[str, object] | None,
    roof_type: str,
    lines: list[float],
) -> dict[str, object]:
    if silhouette is None:
        return decision("standard", 0.0)
    if roof_type == "flat":
        return decision("low", 0.94)
    height = float(silhouette["height"])
    left_run = max(
        1.0,
        float(silhouette["plateau_left"]) - float(silhouette["x_min"]),
    )
    right_run = max(
        1.0,
        float(silhouette["x_max"]) - float(silhouette["plateau_right"]),
    )
    outline_angle = math.degrees(math.atan(height / ((left_run + right_run) * 0.5)))
    stable_lines = [angle for angle in lines if 8.0 <= angle <= 60.0]
    if stable_lines:
        line_angle = float(np.median(stable_lines))
        angle = outline_angle * 0.75 + line_angle * 0.25
        confidence = 0.84
    else:
        angle = outline_angle
        confidence = 0.76
    if angle < 22.0:
        value = "low"
    elif angle <= 31.0:
        value = "standard"
    else:
        value = "high"
    return decision(value, confidence)


def classify_roof_material(image: np.ndarray, mask: np.ndarray) -> dict[str, object]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    valid = mask > 0
    green = (
        (hsv[:, :, 0] >= 35)
        & (hsv[:, :, 0] <= 95)
        & (hsv[:, :, 1] > 70)
    )
    sky_or_glare = (hsv[:, :, 1] < 20) & (hsv[:, :, 2] > 225)
    valid &= ~green & ~sky_or_glare
    if int(valid.sum()) < MIN_EFFECTIVE_PIXELS:
        return decision("gray_tile", 0.0)
    pixels = image[valid].astype(np.float32)
    hsv_pixels = hsv[valid].astype(np.float32)
    red_dominance = float(np.median(pixels[:, 2] - pixels[:, 0]))
    median_saturation = float(np.median(hsv_pixels[:, 1]))
    median_value = float(np.median(hsv_pixels[:, 2]))
    gray_std = float(np.std(gray[valid]))
    if red_dominance > 35.0 and median_saturation > 65.0:
        return decision("terracotta_tile", 0.91)
    if median_value < 82.0 and median_saturation < 48.0 and gray_std > 14.0:
        return decision("asphalt_shingle", 0.78)
    return decision("gray_tile", 0.79)


def apply_confidence_fallbacks(result: dict[str, object]) -> dict[str, object]:
    warnings = list(result.get("warnings", []))
    for key, safe_value in SAFE_VALUES.items():
        current = dict(result[key])
        if float(current["confidence"]) < MIN_CONFIDENCE:
            result[key] = decision(safe_value, float(current["confidence"]), "fallback")
            warnings.append(f"roof_{key}_unclear")
    result["warnings"] = list(dict.fromkeys(warnings))
    return result


def analyze_roof(
    image: np.ndarray,
    roof_top_norm: float,
    building_mask: np.ndarray | None = None,
) -> dict[str, object]:
    if image is None or image.ndim != 3 or image.shape[0] < 2 or image.shape[1] < 2:
        return fallback_roof_analysis(roof_top_norm)
    normalized_top = float(np.clip(roof_top_norm, 0.0, 0.65))
    crop_y = int(round(normalized_top * (image.shape[0] - 1)))
    roi, roi_mask = extract_roof_region(image, crop_y, building_mask)
    if roi.size == 0 or int(cv2.countNonZero(roi_mask)) < MIN_EFFECTIVE_PIXELS:
        return fallback_roof_analysis(normalized_top)
    silhouette = roof_silhouette(roi_mask)
    if silhouette is None:
        return fallback_roof_analysis(normalized_top)
    lines = dominant_roof_lines(roi, roi_mask)
    roof_type = classify_roof_type(silhouette, lines)
    result = {
        "type": roof_type,
        "pitch": classify_roof_pitch(silhouette, str(roof_type["value"]), lines),
        "material": classify_roof_material(roi, roi_mask),
        "warnings": [],
        "detected_features": [],
        "crop_top": round(normalized_top, 6),
    }
    return apply_confidence_fallbacks(result)
