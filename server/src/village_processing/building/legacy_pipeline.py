"""Single-image adapter derived from the existing desktop inference script."""

from pathlib import Path
import json
import math

import cv2
import mmcv
import numpy as np
import rasterio
from rasterio.warp import transform as transform_coordinates
from mmdet.apis import inference_detector


EDGE_IGNORE = 96
MIN_INSTANCE_PIXELS = 150
MAX_ASPECT_RATIO = 8.0
MIN_RECT_FILL_RATIO = 0.45
RECTANGLE_REGULARIZE_FILL_RATIO = 0.78
COMPLEX_SIMPLIFY_RATIOS = (0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.08)
MAX_REGULARIZED_VERTICES = 8
MAX_REGULARIZATION_AREA_CHANGE_RATIO = 0.35
DEDUP_MIN_OVERLAP = 0.75


def _read_three_band_uint8(dataset) -> np.ndarray:
    data = dataset.read(indexes=[1, 2, 3])
    image = np.transpose(data, (1, 2, 0))
    if image.dtype == np.uint8:
        return image
    stretched = image.astype(np.float32)
    for channel in range(3):
        band = stretched[:, :, channel]
        low, high = np.percentile(band, (2, 98))
        if high > low:
            stretched[:, :, channel] = np.clip((band - low) / (high - low) * 255, 0, 255)
        else:
            stretched[:, :, channel] = np.clip(band, 0, 255)
    return stretched.astype(np.uint8)


def _tile_starts(length: int, tile_size: int, overlap: int) -> list[int]:
    if length <= tile_size:
        return [0]
    step = tile_size - overlap
    count = math.ceil((length - tile_size) / step) + 1
    return sorted({min(index * step, length - tile_size) for index in range(count)})


def _tile(image: np.ndarray, x: int, y: int, size: int) -> np.ndarray:
    part = image[y : y + size, x : x + size]
    bottom = size - part.shape[0]
    right = size - part.shape[1]
    if bottom or right:
        part = cv2.copyMakeBorder(part, 0, bottom, 0, right, cv2.BORDER_REFLECT_101)
    return part


def _valid_mask(mask: np.ndarray) -> bool:
    if int(mask.sum()) < MIN_INSTANCE_PIXELS:
        return False
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return False
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    (_, _), (width, height), _ = cv2.minAreaRect(contour)
    if area < MIN_INSTANCE_PIXELS or width < 5 or height < 5:
        return False
    if max(width, height) / max(min(width, height), 1e-6) > MAX_ASPECT_RATIO:
        return False
    return area / max(width * height, 1e-6) >= MIN_RECT_FILL_RATIO


def _is_in_center(mask: np.ndarray) -> bool:
    rows, columns = np.where(mask)
    if not len(columns):
        return False
    return (
        columns.max() >= EDGE_IGNORE
        and columns.min() < mask.shape[1] - EDGE_IGNORE
        and rows.max() >= EDGE_IGNORE
        and rows.min() < mask.shape[0] - EDGE_IGNORE
    )


def _signed_area(points: np.ndarray) -> float:
    return 0.5 * float(
        np.dot(points[:, 0], np.roll(points[:, 1], -1))
        - np.dot(points[:, 1], np.roll(points[:, 0], -1))
    )


def _orientation(first, second, third) -> float:
    return float(
        (second[0] - first[0]) * (third[1] - first[1])
        - (second[1] - first[1]) * (third[0] - first[0])
    )


def _is_self_intersecting(points: np.ndarray) -> bool:
    count = len(points)
    for first_index in range(count):
        first_start = points[first_index]
        first_end = points[(first_index + 1) % count]
        for second_index in range(first_index + 1, count):
            if second_index in (first_index, (first_index + 1) % count) or (second_index + 1) % count == first_index:
                continue
            second_start = points[second_index]
            second_end = points[(second_index + 1) % count]
            first_side = (
                _orientation(first_start, first_end, second_start),
                _orientation(first_start, first_end, second_end),
            )
            second_side = (
                _orientation(second_start, second_end, first_start),
                _orientation(second_start, second_end, first_end),
            )
            if first_side[0] * first_side[1] < -1e-9 and second_side[0] * second_side[1] < -1e-9:
                return True
    return False


def _simplify_contour(contour: np.ndarray) -> np.ndarray:
    perimeter = cv2.arcLength(contour, True)
    best = contour.reshape(-1, 2).astype(np.float64)
    for ratio in COMPLEX_SIMPLIFY_RATIOS:
        approximation = cv2.approxPolyDP(contour, ratio * perimeter, True).reshape(-1, 2).astype(np.float64)
        if len(approximation) >= 4:
            best = approximation
        if 4 <= len(approximation) <= MAX_REGULARIZED_VERTICES:
            return approximation
    return best


def _is_near_right_angle_quadrilateral(points: np.ndarray, tolerance_degrees: float = 15.0) -> bool:
    if len(points) != 4:
        return False
    for index in range(4):
        previous = points[index - 1] - points[index]
        following = points[(index + 1) % 4] - points[index]
        denominator = np.linalg.norm(previous) * np.linalg.norm(following)
        if denominator <= 1e-9:
            return False
        angle = math.degrees(math.acos(float(np.clip(np.dot(previous, following) / denominator, -1.0, 1.0))))
        if abs(angle - 90.0) > tolerance_degrees:
            return False
    return True


def _rotate_points(points: np.ndarray, radians: float) -> np.ndarray:
    cosine, sine = math.cos(radians), math.sin(radians)
    return points @ np.array([[cosine, -sine], [sine, cosine]], dtype=np.float64).T


def _edge_axis(first: np.ndarray, second: np.ndarray) -> str:
    delta = second - first
    return "horizontal" if abs(delta[0]) >= abs(delta[1]) else "vertical"


def _orthogonalize_complex(points: np.ndarray, angle_degrees: float) -> np.ndarray | None:
    center = points.mean(axis=0)
    aligned = _rotate_points(points - center, math.radians(-angle_degrees))
    vertices = list(aligned)
    changed = True
    while changed and len(vertices) > 4:
        changed = False
        for index in range(len(vertices)):
            if _edge_axis(vertices[index - 1], vertices[index]) == _edge_axis(vertices[index], vertices[(index + 1) % len(vertices)]):
                vertices.pop(index)
                changed = True
                break
    aligned = np.asarray(vertices, dtype=np.float64)
    if len(aligned) < 4 or len(aligned) > MAX_REGULARIZED_VERTICES:
        return None

    axes = [_edge_axis(aligned[index], aligned[(index + 1) % len(aligned)]) for index in range(len(aligned))]
    if any(axes[index] == axes[index - 1] for index in range(len(axes))):
        return None
    values = []
    for index, axis in enumerate(axes):
        first, second = aligned[index], aligned[(index + 1) % len(aligned)]
        values.append(float((first[1] + second[1]) / 2 if axis == "horizontal" else (first[0] + second[0]) / 2))

    snapped = []
    for index in range(len(aligned)):
        previous_axis, current_axis = axes[index - 1], axes[index]
        previous_value, current_value = values[index - 1], values[index]
        snapped.append((previous_value, current_value) if previous_axis == "vertical" else (current_value, previous_value))
    return _rotate_points(np.asarray(snapped, dtype=np.float64), math.radians(angle_degrees)) + center


def _regularize_contour(contour: np.ndarray) -> tuple[np.ndarray, str, float]:
    """Return a rectangle, quadrilateral, or 6-8 edge orthogonal footprint."""
    original = contour.reshape(-1, 2).astype(np.float64)
    original_area = _signed_area(original)
    if len(original) < 3 or abs(original_area) <= 1e-9 or _is_self_intersecting(original):
        raise ValueError("INVALID_BUILDING_CONTOUR")

    rect = cv2.minAreaRect(contour)
    rectangle = cv2.boxPoints(rect).astype(np.float64)
    rectangle_area = abs(_signed_area(rectangle))
    fill_ratio = abs(original_area) / max(rectangle_area, 1e-9)
    simplified = _simplify_contour(contour)

    if len(simplified) == 4 and not _is_near_right_angle_quadrilateral(simplified):
        candidate, method = simplified, "quadrilateral"
    elif fill_ratio >= RECTANGLE_REGULARIZE_FILL_RATIO:
        candidate, method = rectangle, "rectangle"
    else:
        candidate = _orthogonalize_complex(simplified, rect[2])
        method = "orthogonal_complex"
        if candidate is None:
            candidate, method = simplified, "simplified_fallback"

    candidate_area = abs(_signed_area(candidate))
    area_change = abs(candidate_area - abs(original_area)) / max(abs(original_area), 1e-9)
    if candidate_area <= 1e-9 or _is_self_intersecting(candidate) or area_change > MAX_REGULARIZATION_AREA_CHANGE_RATIO:
        candidate, method = simplified, "simplified_fallback"
    return candidate.astype(np.float32), method, float(fill_ratio)


def _regularized_polygon_from_mask(mask: np.ndarray, x_offset: int, y_offset: int, affine):
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    ring_points, regularization, rect_fill_ratio = _regularize_contour(contour)
    pixel_coordinates = []
    coordinates = []
    for column, row in ring_points:
        pixel_coordinates.append((float(column + x_offset), float(row + y_offset)))
        x, y = affine * (float(column + x_offset), float(row + y_offset))
        coordinates.append((x, y))
    coordinates.append(coordinates[0])
    contour_x, contour_y, contour_width, contour_height = cv2.boundingRect(contour)
    pixel_bbox = (
        float(contour_x + x_offset),
        float(contour_y + y_offset),
        float(contour_x + contour_width + x_offset),
        float(contour_y + contour_height + y_offset),
    )
    return coordinates, pixel_bbox, regularization, float(rect_fill_ratio)


def _bbox_overlap_ratio(first, second) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    return intersection / max(min(first_area, second_area), 1e-9)


def _deduplicate(records: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for record in sorted(records, key=lambda item: item["score"], reverse=True):
        if any(
            _bbox_overlap_ratio(record["pixel_bbox"], item["pixel_bbox"]) >= DEDUP_MIN_OVERLAP
            for item in kept
        ):
            continue
        kept.append(record)
    return kept


def process_tif(
    *,
    model,
    tif_path: Path,
    output_geojson: Path,
    score_threshold: float = 0.35,
    batch_size: int = 1,
    tile_size: int = 1536,
    overlap: int = 384,
) -> Path:
    """Run the already-loaded model for one GeoTIFF and write WGS84 GeoJSON."""
    if batch_size != 1:
        raise ValueError("BUILDING_BATCH_MUST_BE_ONE")
    records: list[dict] = []
    with rasterio.open(tif_path) as dataset:
        if dataset.count < 3 or dataset.crs is None:
            raise ValueError("INVALID_SOURCE_IMAGERY")
        image = _read_three_band_uint8(dataset)
        for y in _tile_starts(image.shape[0], tile_size, overlap):
            for x in _tile_starts(image.shape[1], tile_size, overlap):
                result = inference_detector(model, [_tile(image, x, y, tile_size)])[0]
                if not isinstance(result, tuple):
                    continue
                bbox_result, segmentation_result = result
                if isinstance(segmentation_result, tuple):
                    segmentation_result = segmentation_result[0]
                boxes = np.vstack(bbox_result) if any(len(item) for item in bbox_result) else np.empty((0, 5))
                masks = mmcv.concat_list(segmentation_result) if segmentation_result is not None else []
                for index in np.where(boxes[:, -1] > score_threshold)[0]:
                    mask = np.asarray(masks[int(index)], dtype=bool)
                    if not _is_in_center(mask) or not _valid_mask(mask):
                        continue
                    polygon = _regularized_polygon_from_mask(mask, x, y, dataset.transform)
                    if polygon is not None:
                        coordinates, pixel_bbox, regularization, rect_fill_ratio = polygon
                        records.append({
                            "coordinates": coordinates,
                            "pixel_bbox": pixel_bbox,
                            "score": float(boxes[int(index), -1]),
                            "regularization": regularization,
                            "rect_fill_ratio": rect_fill_ratio,
                        })
        output_geojson = Path(output_geojson)
        output_geojson.parent.mkdir(parents=True, exist_ok=True)
        features = []
        for record in _deduplicate(records):
            xs = [point[0] for point in record["coordinates"]]
            ys = [point[1] for point in record["coordinates"]]
            longitudes, latitudes = transform_coordinates(dataset.crs, "EPSG:4326", xs, ys)
            ring = [[longitude, latitude] for longitude, latitude in zip(longitudes, latitudes)]
            features.append({
                "type": "Feature",
                "properties": {
                    "score": record["score"],
                    "regularization": record["regularization"],
                    "rect_fill_ratio": record["rect_fill_ratio"],
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
        payload = {"type": "FeatureCollection", "features": features}
        output_geojson.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
    return output_geojson
