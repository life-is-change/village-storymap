from pathlib import Path

import pytest

from village_processing.catalog import load_catalog, resolve_under_root


def test_catalog_resolves_existing_relative_assets(tmp_path: Path):
    for name in ("imagery.tif", "dem.tif", "osm.pbf", "model.py", "model.pth"):
        (tmp_path / name).touch()
    manifest = tmp_path / "villages.yaml"
    manifest.write_text(
        """villages:
  mibu:
    imagery: imagery.tif
    dem: dem.tif
    osm: osm.pbf
    bounds: [113.6, 23.6, 113.7, 23.7]
    model_config: model.py
    model_checkpoint: model.pth
    osm_snapshot: '2026-07-21'
    dem_source: Copernicus DEM GLO-30
""",
        "utf-8",
    )

    item = load_catalog(manifest, tmp_path).resolve("mibu")

    assert item.imagery == (tmp_path / "imagery.tif").resolve()
    assert item.bounds == (113.6, 23.6, 113.7, 23.7)
    assert item.osm_snapshot == "2026-07-21"


def test_path_escape_is_rejected(tmp_path: Path):
    with pytest.raises(ValueError, match="DATASET_PATH_ESCAPE"):
        resolve_under_root(tmp_path, "../secret.txt")


def test_unknown_village_is_rejected(tmp_path: Path):
    manifest = tmp_path / "villages.yaml"
    manifest.write_text("villages: {}\n", "utf-8")

    with pytest.raises(KeyError, match="DATASET_NOT_REGISTERED"):
        load_catalog(manifest, tmp_path).resolve("unknown")
