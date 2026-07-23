import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds

from village_processing.preview import generate_preview


def test_generate_preview_writes_rgb_webp_and_public_catalog(tmp_path: Path):
    source = tmp_path / "source.tif"
    transform = from_bounds(113.65, 23.67, 113.67, 23.69, 120, 60)
    data = np.zeros((3, 60, 120), dtype=np.uint8)
    data[0, :, :] = 180
    data[1, :, :] = 120
    data[2, :, :] = 60
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=120,
        height=60,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=transform,
    ) as dataset:
        dataset.write(data)

    assets_root = tmp_path / "assets"
    entry = generate_preview(source, assets_root, "mibu", "米埗村", max_edge=80)

    preview = assets_root / "villages" / "mibu" / "preview.webp"
    catalog = json.loads((assets_root / "villages" / "catalog.json").read_text("utf-8"))
    assert preview.is_file()
    assert entry["preview_path"] == "assets/villages/mibu/preview.webp"
    assert entry["bounds"] == [113.65, 23.67, 113.67, 23.69]
    assert catalog["villages"][0]["id"] == "mibu"
    assert "source" not in catalog["villages"][0]
    with Image.open(preview) as image:
        assert image.mode == "RGB"
        assert max(image.size) <= 80


def test_generate_preview_preserves_other_village_catalog_entries(tmp_path: Path):
    source = tmp_path / "source.tif"
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(1, 2, 3, 4, 2, 2),
    ) as dataset:
        dataset.write(np.ones((3, 2, 2), dtype=np.uint8))
    catalog_path = tmp_path / "assets" / "villages" / "catalog.json"
    catalog_path.parent.mkdir(parents=True)
    catalog_path.write_text(json.dumps({"villages": [{"id": "other"}]}), "utf-8")

    generate_preview(source, tmp_path / "assets", "mibu", "米埗村")

    ids = [item["id"] for item in json.loads(catalog_path.read_text("utf-8"))["villages"]]
    assert ids == ["mibu", "other"]
