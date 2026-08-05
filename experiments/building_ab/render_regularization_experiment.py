"""Render before/after building regularization previews without geometry bindings."""

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
BASE = ROOT / "output_result" / "ab_compare_20260727"
CURRENT = BASE / "strict" / "buildings.geojson"
OUTPUT_DIR = BASE / "regularization_v1"
REGULARIZED = OUTPUT_DIR / "buildings_regularized.geojson"


def stretch_rgb(data: np.ndarray) -> np.ndarray:
    image = np.transpose(data, (1, 2, 0)).astype(np.float32)
    for channel in range(3):
        band = image[:, :, channel]
        low, high = np.percentile(band, (2, 98))
        image[:, :, channel] = np.clip((band - low) / (high - low), 0, 1) if high > low else 0
    return image


def load_basemap(max_width=2600):
    with rasterio.open(TIF) as dataset:
        scale = min(1.0, max_width / dataset.width)
        width, height = int(dataset.width * scale), int(dataset.height * scale)
        data = dataset.read([1, 2, 3], out_shape=(3, height, width), resampling=Resampling.bilinear)
        bounds = dataset.bounds
        return stretch_rgb(data), (bounds.left, bounds.right, bounds.bottom, bounds.top), dataset.width, dataset.height


def load_features(path):
    return json.loads(path.read_text("utf-8"))["features"]


def ring(feature):
    return np.asarray(feature["geometry"]["coordinates"][0], dtype=np.float64)


def plot_base(ax, image, extent, limits=None):
    ax.imshow(image, extent=extent, origin="upper")
    if limits:
        ax.set_xlim(limits[0], limits[1])
        ax.set_ylim(limits[2], limits[3])
    else:
        ax.set_xlim(extent[0], extent[1])
        ax.set_ylim(extent[2], extent[3])
    ax.set_axis_off()


def plot_current(ax, features, linewidth=0.8):
    for feature in features:
        points = ring(feature)
        ax.plot(points[:, 0], points[:, 1], color="#ff3030", linewidth=linewidth)


def plot_regularized(ax, features, linewidth=0.8):
    for feature in features:
        points = ring(feature)
        ax.plot(points[:, 0], points[:, 1], color="#00e5ff", linewidth=linewidth)


def choose_details(current, regularized, extent, limit=4):
    candidates = []
    for index, feature in enumerate(regularized):
        properties = feature.get("properties", {})
        original_vertices = int(properties.get("original_vertex_count", 4))
        regularized_vertices = int(properties.get("regularized_vertex_count", 4))
        area_change = float(properties.get("regularization_area_change_ratio", 0))
        if original_vertices > 4:
            points = ring(feature)[:-1]
            center = tuple(points.mean(axis=0))
            priority = (1000 if regularized_vertices >= 6 else 0) + regularized_vertices * 10 + original_vertices + area_change
            candidates.append((priority, index, center))
    candidates.sort(reverse=True)
    spacing = max(extent[1] - extent[0], extent[3] - extent[2]) * 0.09
    selected = []
    for _, index, center in candidates:
        if all(math.dist(center, other[1]) >= spacing for other in selected):
            selected.append((index, center))
        if len(selected) == limit:
            break
    return selected


def render_panel_set(current, regularized, image, extent, limits, title, path, linewidth):
    fig, axes = plt.subplots(1, 3, figsize=(21, 7), constrained_layout=True)
    for ax in axes:
        plot_base(ax, image, extent, limits)
    plot_current(axes[0], current, linewidth)
    axes[0].set_title("Current Linux regularization", fontsize=12)
    plot_regularized(axes[1], regularized, linewidth)
    axes[1].set_title("Adaptive rectangle / orthogonal result", fontsize=12)
    plot_current(axes[2], current, linewidth)
    plot_regularized(axes[2], regularized, linewidth)
    axes[2].set_title("Overlay: red=current, cyan=new", fontsize=12)
    fig.suptitle(title, fontsize=15)
    fig.savefig(path, dpi=190, bbox_inches="tight")
    plt.close(fig)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    image, extent, raster_width, raster_height = load_basemap()
    current, regularized = load_features(CURRENT), load_features(REGULARIZED)
    overview = OUTPUT_DIR / "regularization_overview.png"
    render_panel_set(
        current, regularized, image, extent, None,
        "Mibu footprint regularization: before and after (same 262 detections)", overview, 0.8,
    )

    pixel_width = (extent[1] - extent[0]) / raster_width
    pixel_height = (extent[3] - extent[2]) / raster_height
    details = []
    for number, (index, center) in enumerate(choose_details(current, regularized, extent), start=1):
        limits = (
            center[0] - 430 * pixel_width, center[0] + 430 * pixel_width,
            center[1] - 430 * pixel_height, center[1] + 430 * pixel_height,
        )
        path = OUTPUT_DIR / f"regularization_detail_{number}.png"
        properties = regularized[index].get("properties", {})
        title = (
            f"Detail {number}: {properties.get('original_vertex_count')} to "
            f"{properties.get('regularized_vertex_count')} vertices; "
            f"method={properties.get('regularization_experiment')}"
        )
        render_panel_set(current, regularized, image, extent, limits, title, path, 1.3)
        details.append(str(path))
    print(json.dumps({"overview": str(overview), "details": details}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
