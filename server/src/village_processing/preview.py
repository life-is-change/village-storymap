import json
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds


def _to_display_byte(band: np.ma.MaskedArray) -> np.ndarray:
    values = band.compressed()
    if values.size == 0:
        return np.zeros(band.shape, dtype=np.uint8)
    low, high = np.percentile(values.astype(np.float32), (1, 99))
    if high <= low:
        low = float(values.min())
        high = float(values.max())
    if high <= low:
        return np.full(band.shape, np.clip(low, 0, 255), dtype=np.uint8)
    scaled = (band.astype(np.float32) - low) * (255.0 / (high - low))
    return np.ma.filled(np.ma.clip(scaled, 0, 255), 0).astype(np.uint8)


def _read_preview_rgb(source: rasterio.io.DatasetReader, max_edge: int) -> np.ndarray:
    if source.count < 3 or source.crs is None:
        raise ValueError("INVALID_SOURCE_IMAGERY")
    scale = min(1.0, float(max_edge) / max(source.width, source.height))
    width = max(1, round(source.width * scale))
    height = max(1, round(source.height * scale))
    data = source.read(
        [1, 2, 3],
        out_shape=(3, height, width),
        resampling=Resampling.bilinear,
        masked=True,
    )
    return np.stack([_to_display_byte(data[index]) for index in range(3)], axis=-1)


def generate_preview(
    source_path: Path,
    assets_root: Path,
    village_id: str,
    display_name: str,
    max_edge: int = 2000,
) -> dict:
    if not str(village_id).strip():
        raise ValueError("VILLAGE_ID_REQUIRED")
    if max_edge < 1:
        raise ValueError("PREVIEW_MAX_EDGE_INVALID")
    assets_root = Path(assets_root)
    output = assets_root / "villages" / village_id / "preview.webp"
    output.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(source_path) as source:
        rgb = _read_preview_rgb(source, max_edge)
        bounds = transform_bounds(source.crs, "EPSG:4326", *source.bounds, densify_pts=21)
    Image.fromarray(rgb, mode="RGB").save(output, "WEBP", quality=86, method=6)

    entry = {
        "id": village_id,
        "name": str(display_name or village_id),
        "preview_path": f"assets/villages/{village_id}/preview.webp",
        "bounds": [float(value) for value in bounds],
        "width": int(rgb.shape[1]),
        "height": int(rgb.shape[0]),
    }
    catalog_path = assets_root / "villages" / "catalog.json"
    if catalog_path.is_file():
        existing = json.loads(catalog_path.read_text("utf-8"))
    else:
        existing = {"villages": []}
    entries = {
        str(item.get("id")): item
        for item in existing.get("villages", [])
        if isinstance(item, dict) and item.get("id")
    }
    entries[village_id] = entry
    catalog_path.write_text(
        json.dumps({"villages": [entries[key] for key in sorted(entries)]}, ensure_ascii=False, indent=2) + "\n",
        "utf-8",
    )
    return entry
