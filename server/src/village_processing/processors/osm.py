from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import geopandas as gpd
from shapely.geometry import shape

from village_processing.contracts import ArtifactSummary


ROAD_VALUES = frozenset({
    "motorway", "trunk", "primary", "secondary", "tertiary", "residential",
    "unclassified", "service", "living_street", "track", "path", "footway", "cycleway",
})
WATERWAY_VALUES = frozenset({"river", "stream", "canal", "ditch", "drain"})
WATER_NATURAL_VALUES = frozenset({"water"})
WATER_LANDUSE_VALUES = frozenset({"reservoir", "basin"})
ATTRIBUTION = "© OpenStreetMap contributors"
WINDOWS_OGR2OGR = Path(r"E:\anaconda3\envs\platform_geo_worker\Library\bin\ogr2ogr.exe")


def classify_line(tags: dict) -> str | None:
    if tags.get("highway") in ROAD_VALUES:
        return "road"
    if tags.get("waterway") in WATERWAY_VALUES:
        return "waterway"
    return None


def classify_area(tags: dict) -> str | None:
    if tags.get("natural") in WATER_NATURAL_VALUES or tags.get("landuse") in WATER_LANDUSE_VALUES:
        return "water_area"
    return None


def write_geojson(features, output_path: Path, artifact_type: str, snapshot: str) -> ArtifactSummary:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(features, gpd.GeoDataFrame) and len(features):
        frame = features.to_crs(4326)
        frame["source"] = "osm"
        frame["osm_snapshot"] = snapshot
        frame["attribution"] = ATTRIBUTION
        frame.to_file(output_path, driver="GeoJSON")
        count = len(frame)
        bbox = tuple(float(value) for value in frame.total_bounds)
    else:
        output_path.write_text(json.dumps({"type": "FeatureCollection", "features": []}), "utf-8")
        count = 0
        bbox = (0.0, 0.0, 0.0, 0.0)
    digest = sha256(output_path.read_bytes()).hexdigest()
    return ArtifactSummary(
        path=output_path,
        artifact_type=artifact_type,
        feature_count=count,
        bbox=bbox,
        sha256=digest,
        source=json.dumps({"type": "osm", "snapshot": snapshot, "attribution": ATTRIBUTION}, ensure_ascii=False),
        warning_code="OSM_LAYER_EMPTY" if count == 0 else None,
    )


def _where(field: str, values: frozenset[str]) -> str:
    quoted = ",".join(f"'{value}'" for value in sorted(values))
    return f'"{field}" IN ({quoted})'


def resolve_ogr2ogr(override: Path | None = None) -> Path:
    if override is not None:
        executable = Path(override)
    elif configured := os.environ.get("PLATFORM_OGR2OGR"):
        executable = Path(configured)
    elif discovered := shutil.which("ogr2ogr"):
        executable = Path(discovered)
    else:
        executable = WINDOWS_OGR2OGR
    if not executable.is_file():
        raise FileNotFoundError(f"OGR2OGR_NOT_FOUND: {executable}")
    return executable


def _extract_layer(ogr2ogr: Path, pbf: Path, gpkg: Path, source_layer: str, target_layer: str, bounds, where: str):
    command = [
        str(ogr2ogr), "-f", "GPKG", str(gpkg), str(pbf), source_layer,
        "-spat", *(str(value) for value in bounds),
        "-where", where, "-nln", target_layer,
    ]
    subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")


def extract_osm_layers(
    pbf_path: Path,
    aoi: dict,
    output_dir: Path,
    snapshot: str = "unknown",
    ogr2ogr: Path | None = None,
) -> list[ArtifactSummary]:
    geometry = shape(aoi)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError("INVALID_AOI")
    bounds = geometry.bounds
    aoi_frame = gpd.GeoDataFrame(geometry=[geometry], crs=4326)
    output_dir = Path(output_dir)
    executable = resolve_ogr2ogr(ogr2ogr)

    specifications = [
        ("roads", "lines", _where("highway", ROAD_VALUES)),
        ("waterways", "lines", _where("waterway", WATERWAY_VALUES)),
        ("water_areas", "multipolygons", f'({_where("natural", WATER_NATURAL_VALUES)}) OR ({_where("landuse", WATER_LANDUSE_VALUES)})'),
    ]
    summaries = []
    with tempfile.TemporaryDirectory(prefix="village-osm-") as temporary:
        for name, source_layer, where in specifications:
            gpkg = Path(temporary) / f"{name}.gpkg"
            _extract_layer(executable, Path(pbf_path), gpkg, source_layer, name, bounds, where)
            frame = gpd.read_file(gpkg, layer=name)
            if frame.crs is None:
                frame = frame.set_crs(4326)
            frame = gpd.clip(frame.to_crs(4326), aoi_frame)
            summaries.append(write_geojson(frame, output_dir / f"{name}.geojson", name, snapshot))
    return summaries
