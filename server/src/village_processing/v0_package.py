"""Build and validate the portable village V0 administrator package."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
from typing import Mapping
from zipfile import ZIP_DEFLATED, ZipFile


SCHEMA_VERSION = "village-v0-package/1"
SOURCE_FILES = {
    "boundary": "boundary.geojson",
    "imagery": "imagery.webp",
    "buildings": "buildings.geojson",
    "roads": "roads.geojson",
    "waterways": "waterways.geojson",
    "water_areas": "water_areas.geojson",
    "contours": "contours.geojson",
}
LAYER_FILES = {
    "building": "buildings.geojson",
    "road": "roads.geojson",
    "water": "water.geojson",
    "contours": "contours.geojson",
}


@dataclass(frozen=True)
class PackageResult:
    package_dir: Path
    zip_path: Path
    manifest: dict
    validation: dict


def _digest(path: Path) -> str:
    hasher = sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def _read_collection(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"PACKAGE_GEOJSON_INVALID: {path.name}") from exc
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError(f"PACKAGE_GEOJSON_INVALID: {path.name}")
    return payload


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value).strip()).strip("-").lower()
    if not slug:
        raise ValueError("PACKAGE_VILLAGE_SLUG_REQUIRED")
    return slug


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def validate_v0_package(package_dir: Path) -> dict:
    package_dir = Path(package_dir)
    try:
        manifest = json.loads((package_dir / "manifest.json").read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("PACKAGE_MANIFEST_INVALID") from exc
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("PACKAGE_SCHEMA_UNSUPPORTED")
    file_entries = manifest.get("files")
    if not isinstance(file_entries, list):
        raise ValueError("PACKAGE_FILES_INVALID")
    required = set(SOURCE_FILES.values()) | {"water.geojson"}
    declared = {str(item.get("path")): item for item in file_entries if isinstance(item, dict)}
    missing = sorted(required - set(declared))
    if missing:
        raise ValueError(f"PACKAGE_FILE_MISSING: {missing[0]}")
    for relative, item in declared.items():
        if Path(relative).name != relative:
            raise ValueError(f"PACKAGE_PATH_INVALID: {relative}")
        target = package_dir / relative
        if not target.is_file():
            raise ValueError(f"PACKAGE_FILE_MISSING: {relative}")
        if _digest(target) != item.get("sha256"):
            raise ValueError(f"PACKAGE_HASH_MISMATCH: {relative}")
    feature_counts = {}
    for name in ("boundary", "buildings", "roads", "waterways", "water_areas", "water", "contours"):
        payload = _read_collection(package_dir / f"{name}.geojson")
        feature_counts[name] = len(payload["features"])
    if feature_counts["buildings"] < 1:
        raise ValueError("PACKAGE_BUILDINGS_REQUIRED")
    bounds = manifest.get("village", {}).get("bounds")
    if not isinstance(bounds, list) or len(bounds) != 4 or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise ValueError("PACKAGE_BOUNDS_INVALID")
    return {
        "valid": True,
        "schema_version": SCHEMA_VERSION,
        "feature_counts": feature_counts,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "warnings": [name for name, count in feature_counts.items() if name not in {"boundary", "buildings"} and count == 0],
    }


def build_v0_package(
    *,
    output_root: Path,
    village_name: str,
    village_slug: str,
    source_paths: Mapping[str, Path],
    bounds: list[float] | tuple[float, float, float, float],
    parameters: Mapping | None = None,
) -> PackageResult:
    name = str(village_name).strip()
    if not name:
        raise ValueError("PACKAGE_VILLAGE_NAME_REQUIRED")
    slug = _safe_slug(village_slug)
    missing_keys = [key for key in SOURCE_FILES if key not in source_paths or not Path(source_paths[key]).is_file()]
    if missing_keys:
        raise ValueError(f"PACKAGE_SOURCE_MISSING: {missing_keys[0]}")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    package_dir = Path(output_root) / f"{slug}-v0-{stamp}"
    suffix = 2
    while package_dir.exists():
        package_dir = Path(output_root) / f"{slug}-v0-{stamp}-{suffix}"
        suffix += 1
    package_dir.mkdir(parents=True)
    for key, filename in SOURCE_FILES.items():
        shutil.copy2(Path(source_paths[key]), package_dir / filename)

    waterways = _read_collection(package_dir / "waterways.geojson")
    water_areas = _read_collection(package_dir / "water_areas.geojson")
    _write_json(package_dir / "water.geojson", {
        "type": "FeatureCollection",
        "features": waterways["features"] + water_areas["features"],
    })

    files = []
    for path in sorted(item for item in package_dir.iterdir() if item.is_file()):
        files.append({"path": path.name, "sha256": _digest(path), "bytes": path.stat().st_size})
    counts = {
        layer_type: len(_read_collection(package_dir / filename)["features"])
        for layer_type, filename in LAYER_FILES.items()
    }
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "village": {"name": name, "slug": slug, "bounds": [float(value) for value in bounds], "default_crs": "EPSG:4326"},
        "parameters": dict(parameters or {}),
        "files": files,
        "imagery": {"path": "imagery.webp", "bounds": [float(value) for value in bounds]},
        "layers": [
            {"type": layer_type, "path": filename, "featureCount": counts[layer_type]}
            for layer_type, filename in LAYER_FILES.items()
        ],
    }
    _write_json(package_dir / "manifest.json", manifest)
    validation = validate_v0_package(package_dir)
    _write_json(package_dir / "validation.json", validation)

    zip_path = package_dir.with_suffix(".zip")
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(package_dir.iterdir()):
            archive.write(path, path.name)
    return PackageResult(package_dir, zip_path, manifest, validation)
