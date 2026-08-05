"""Render overview, detail panels, and statistics without GDAL/Shapely geometry bindings."""

from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio.enums import Resampling


ROOT = Path(r"E:\村规平台学生体验版\建筑矢量")
TIF = ROOT / "input_tif" / "米埗村（洛一洛二洛三）.tif"
OUTPUT = ROOT / "output_result" / "ab_compare_20260727"
FILES = {
    "Source-like": OUTPUT / "source" / "buildings.geojson",
    "Strict": OUTPUT / "strict" / "buildings.geojson",
    "Balanced": OUTPUT / "balanced" / "buildings.geojson",
}


def stretch_rgb(data: np.ndarray) -> np.ndarray:
    image = np.transpose(data, (1, 2, 0)).astype(np.float32)
    for channel in range(3):
        band = image[:, :, channel]
        low, high = np.percentile(band, (2, 98))
        image[:, :, channel] = (
            np.clip((band - low) / (high - low), 0, 1)
            if high > low
            else np.clip(band / 255.0, 0, 1)
        )
    return image


def load_basemap(max_width: int = 2600):
    with rasterio.open(TIF) as dataset:
        scale = min(1.0, max_width / dataset.width)
        out_width = max(1, int(dataset.width * scale))
        out_height = max(1, int(dataset.height * scale))
        data = dataset.read(
            [1, 2, 3],
            out_shape=(3, out_height, out_width),
            resampling=Resampling.bilinear,
        )
        bounds = dataset.bounds
        return stretch_rgb(data), (bounds.left, bounds.right, bounds.bottom, bounds.top)


def signed_area(ring) -> float:
    return 0.5 * sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(ring, ring[1:])
    )


def make_record(feature):
    ring = feature["geometry"]["coordinates"][0]
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return {
        "ring": ring,
        "bbox": (min(xs), min(ys), max(xs), max(ys)),
        "centroid": (sum(xs[:-1]) / max(len(xs) - 1, 1), sum(ys[:-1]) / max(len(ys) - 1, 1)),
        "area_degrees": abs(signed_area(ring)),
        "properties": feature.get("properties", {}),
    }


def load_records(path: Path):
    payload = json.loads(path.read_text("utf-8"))
    return [make_record(feature) for feature in payload["features"]]


def bbox_area(bbox) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def bbox_match(first, second) -> bool:
    left = max(first[0], second[0])
    bottom = max(first[1], second[1])
    right = min(first[2], second[2])
    top = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, top - bottom)
    return intersection / max(min(bbox_area(first), bbox_area(second)), 1e-12) >= 0.35


def has_match(record, others) -> bool:
    return any(bbox_match(record["bbox"], other["bbox"]) for other in others)


def select_detail_centers(frames, limit: int = 4):
    candidates = []
    for record in frames["Balanced"]:
        if not has_match(record, frames["Strict"]):
            candidates.append(("Balanced adds", record["centroid"]))
    for record in frames["Source-like"]:
        if not has_match(record, frames["Balanced"]):
            candidates.append(("Source-only", record["centroid"]))

    all_boxes = [record["bbox"] for records in frames.values() for record in records]
    width = max(item[2] for item in all_boxes) - min(item[0] for item in all_boxes)
    height = max(item[3] for item in all_boxes) - min(item[1] for item in all_boxes)
    minimum_spacing = max(width, height) * 0.12
    selected = []
    for label, point in candidates:
        if all(math.dist(point, existing[1]) >= minimum_spacing for existing in selected):
            selected.append((label, point))
        if len(selected) == limit:
            break
    return selected


def plot_panel(ax, image, extent, records, title, limits=None):
    ax.imshow(image, extent=extent, origin="upper")
    for record in records:
        ring = np.asarray(record["ring"])
        ax.plot(ring[:, 0], ring[:, 1], color="#ff2d2d", linewidth=0.8)
    ax.set_title(f"{title} (n={len(records)})", fontsize=11)
    if limits:
        ax.set_xlim(limits[0], limits[1])
        ax.set_ylim(limits[2], limits[3])
    else:
        ax.set_xlim(extent[0], extent[1])
        ax.set_ylim(extent[2], extent[3])
    ax.set_axis_off()


def approximate_area_m2(record) -> float:
    latitude = record["centroid"][1]
    return record["area_degrees"] * (111320 * math.cos(math.radians(latitude))) * 110540


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image, extent = load_basemap()
    frames = {name: load_records(path) for name, path in FILES.items()}

    fig, axes = plt.subplots(1, 3, figsize=(21, 7), constrained_layout=True)
    for ax, (name, records) in zip(axes, frames.items()):
        plot_panel(ax, image, extent, records, name)
    fig.suptitle("Mibu building extraction: same image, model, and score threshold (0.35)", fontsize=15)
    overview = OUTPUT / "comparison_overview.png"
    fig.savefig(overview, dpi=180, bbox_inches="tight")
    plt.close(fig)

    centers = select_detail_centers(frames)
    pixel_width = abs(extent[1] - extent[0]) / 8956
    pixel_height = abs(extent[3] - extent[2]) / 5083
    half_width = 550 * pixel_width
    half_height = 550 * pixel_height
    detail_paths = []
    for index, (label, point) in enumerate(centers, start=1):
        limits = (
            point[0] - half_width,
            point[0] + half_width,
            point[1] - half_height,
            point[1] + half_height,
        )
        fig, axes = plt.subplots(1, 3, figsize=(18, 6), constrained_layout=True)
        for ax, (name, records) in zip(axes, frames.items()):
            plot_panel(ax, image, extent, records, name, limits)
        fig.suptitle(f"Detail {index}: {label}", fontsize=14)
        path = OUTPUT / f"comparison_detail_{index}.png"
        fig.savefig(path, dpi=200, bbox_inches="tight")
        plt.close(fig)
        detail_paths.append(str(path))

    stats = {}
    for name, records in frames.items():
        scores = [float(record["properties"].get("score", 0)) for record in records]
        stats[name] = {
            "features": len(records),
            "unclosed_or_short_rings": sum(
                len(record["ring"]) < 4 or record["ring"][0] != record["ring"][-1]
                for record in records
            ),
            "mean_score": round(float(np.mean(scores)), 4),
            "median_score": round(float(np.median(scores)), 4),
            "total_area_m2_approx": round(sum(approximate_area_m2(record) for record in records), 2),
        }
    stats["comparison"] = {
        "balanced_added_vs_strict": sum(not has_match(record, frames["Strict"]) for record in frames["Balanced"]),
        "source_only_vs_balanced": sum(not has_match(record, frames["Balanced"]) for record in frames["Source-like"]),
        "overview": str(overview),
        "details": detail_paths,
    }
    stats_path = OUTPUT / "comparison_stats.json"
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
