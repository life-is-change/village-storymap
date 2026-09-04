import json
from pathlib import Path
from zipfile import ZipFile

import pytest

from village_processing.v0_package import build_v0_package, validate_v0_package


def _feature_collection(count=1):
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"id": index}, "geometry": None}
            for index in range(count)
        ],
    }


def _write_inputs(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, count in {
        "boundary": 1,
        "buildings": 2,
        "roads": 3,
        "waterways": 1,
        "water_areas": 1,
        "contours": 4,
    }.items():
        path = root / f"{name}.geojson"
        path.write_text(json.dumps(_feature_collection(count)), "utf-8")
        paths[name] = path
    imagery = root / "imagery.webp"
    imagery.write_bytes(b"RIFF-test-webp")
    paths["imagery"] = imagery
    return paths


def test_package_is_self_contained_hashed_and_zip_backed_up(tmp_path: Path):
    inputs = _write_inputs(tmp_path / "inputs")
    result = build_v0_package(
        output_root=tmp_path / "output",
        village_name="测试村",
        village_slug="test-village",
        source_paths=inputs,
        bounds=[113.1, 23.1, 113.2, 23.2],
        parameters={"building_threshold": 0.5, "contour_interval": 10},
    )

    manifest = json.loads((result.package_dir / "manifest.json").read_text("utf-8"))
    report = validate_v0_package(result.package_dir)

    assert report["valid"] is True
    assert report["feature_counts"] == {
        "boundary": 1,
        "buildings": 2,
        "roads": 3,
        "waterways": 1,
        "water_areas": 1,
        "water": 2,
        "contours": 4,
    }
    assert manifest["schema_version"] == "village-v0-package/1"
    assert manifest["village"]["name"] == "测试村"
    assert {layer["type"] for layer in manifest["layers"]} == {
        "building", "road", "water", "contours"
    }
    assert all(len(item["sha256"]) == 64 for item in manifest["files"])
    assert result.zip_path.is_file()
    with ZipFile(result.zip_path) as archive:
        names = set(archive.namelist())
    assert "manifest.json" in names
    assert "validation.json" in names
    assert "water.geojson" in names


def test_validation_rejects_a_changed_file(tmp_path: Path):
    inputs = _write_inputs(tmp_path / "inputs")
    result = build_v0_package(
        output_root=tmp_path / "output",
        village_name="测试村",
        village_slug="test-village",
        source_paths=inputs,
        bounds=[113.1, 23.1, 113.2, 23.2],
    )
    (result.package_dir / "buildings.geojson").write_text("{}", "utf-8")

    with pytest.raises(ValueError, match="PACKAGE_HASH_MISMATCH: buildings.geojson"):
        validate_v0_package(result.package_dir)


def test_build_rejects_missing_required_output(tmp_path: Path):
    inputs = _write_inputs(tmp_path / "inputs")
    inputs.pop("contours")

    with pytest.raises(ValueError, match="PACKAGE_SOURCE_MISSING: contours"):
        build_v0_package(
            output_root=tmp_path / "output",
            village_name="测试村",
            village_slug="test-village",
            source_paths=inputs,
            bounds=[113.1, 23.1, 113.2, 23.2],
        )
