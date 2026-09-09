import json

from village_processing.processors import osm
from village_processing.processors.osm import (
    classify_area,
    classify_line,
    write_geojson,
)


def test_osm_tag_classification():
    assert classify_line({"highway": "residential"}) == "road"
    assert classify_line({"highway": "unclassified"}) == "road"
    assert classify_line({"waterway": "ditch"}) == "waterway"
    assert classify_line({"highway": "construction"}) is None
    assert classify_area({"natural": "water"}) == "water_area"
    assert classify_area({"landuse": "reservoir"}) == "water_area"


def test_empty_layer_is_valid_warning(tmp_path):
    output = tmp_path / "waterways.geojson"
    summary = write_geojson([], output, "waterways", "2026-07-21")

    assert summary.feature_count == 0
    assert summary.warning_code == "OSM_LAYER_EMPTY"
    assert json.loads(output.read_text("utf-8")) == {"type": "FeatureCollection", "features": []}


def test_ogr2ogr_resolution_uses_environment_override_first(tmp_path, monkeypatch):
    configured = tmp_path / "configured-ogr2ogr"
    configured.touch()
    discovered = tmp_path / "path-ogr2ogr"
    discovered.touch()
    monkeypatch.setenv("PLATFORM_OGR2OGR", str(configured))
    monkeypatch.setattr(osm.shutil, "which", lambda _name: str(discovered))

    assert osm.resolve_ogr2ogr() == configured


def test_ogr2ogr_resolution_discovers_linux_executable_on_path(tmp_path, monkeypatch):
    discovered = tmp_path / "ogr2ogr"
    discovered.touch()
    monkeypatch.delenv("PLATFORM_OGR2OGR", raising=False)
    monkeypatch.setattr(osm.shutil, "which", lambda _name: str(discovered))

    assert osm.resolve_ogr2ogr() == discovered
