import json

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
