from pathlib import Path
from zipfile import ZipFile

import geopandas as gpd
import pytest
from shapely.geometry import box

from village_processing.boundary import (
    extract_boundary_archive,
    normalize_boundary_file,
    validate_archive_members,
)


def test_archive_rejects_path_escape():
    with pytest.raises(ValueError, match="BOUNDARY_ARCHIVE_PATH_ESCAPE"):
        validate_archive_members(["../outside.shp", "village.dbf"])


def test_archive_rejects_absolute_and_excess_members():
    with pytest.raises(ValueError, match="BOUNDARY_ARCHIVE_PATH_ESCAPE"):
        validate_archive_members(["C:/outside.shp"])
    with pytest.raises(ValueError, match="BOUNDARY_ARCHIVE_TOO_MANY_MEMBERS"):
        validate_archive_members([f"part-{index}.txt" for index in range(101)])


def test_archive_requires_complete_shapefile(tmp_path: Path):
    archive = tmp_path / "boundary.zip"
    with ZipFile(archive, "w") as output:
        output.writestr("village.shp", b"empty")
    with pytest.raises(ValueError, match="BOUNDARY_SHAPEFILE_COMPONENT_MISSING"):
        extract_boundary_archive(archive, tmp_path / "work")


def test_geojson_boundary_is_reprojected_to_4326(tmp_path: Path):
    source = tmp_path / "boundary.geojson"
    gpd.GeoDataFrame(
        geometry=[box(12600000, 2600000, 12601000, 2601000)],
        crs="EPSG:3857",
    ).to_file(source, driver="GeoJSON")
    result = normalize_boundary_file(source)
    assert result["type"] == "MultiPolygon"
    assert -180 <= result["coordinates"][0][0][0][0] <= 180


def test_non_polygon_boundary_is_rejected(tmp_path: Path):
    source = tmp_path / "points.geojson"
    gpd.GeoDataFrame(geometry=gpd.points_from_xy([113], [23]), crs="EPSG:4326").to_file(
        source, driver="GeoJSON"
    )
    with pytest.raises(ValueError, match="BOUNDARY_POLYGON_REQUIRED"):
        normalize_boundary_file(source)
