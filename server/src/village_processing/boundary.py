"""Safe village-boundary archive extraction and WGS84 normalization."""

from __future__ import annotations

from pathlib import Path, PurePosixPath, PureWindowsPath
from zipfile import ZipFile, ZipInfo

import geopandas as gpd
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping

MAX_ARCHIVE_MEMBERS = 100
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024


def validate_archive_members(names: list[str]) -> None:
    if len(names) > MAX_ARCHIVE_MEMBERS:
        raise ValueError("BOUNDARY_ARCHIVE_TOO_MANY_MEMBERS")
    for name in names:
        posix = PurePosixPath(name.replace("\\", "/"))
        windows = PureWindowsPath(name)
        if posix.is_absolute() or windows.is_absolute() or ".." in posix.parts:
            raise ValueError("BOUNDARY_ARCHIVE_PATH_ESCAPE")


def _is_symlink(member: ZipInfo) -> bool:
    return ((member.external_attr >> 16) & 0o170000) == 0o120000


def extract_boundary_archive(zip_path: str | Path, work_dir: str | Path) -> Path:
    destination = Path(work_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(zip_path) as archive:
        members = archive.infolist()
        validate_archive_members([member.filename for member in members])
        if any(_is_symlink(member) for member in members):
            raise ValueError("BOUNDARY_ARCHIVE_SYMLINK")
        if sum(member.file_size for member in members) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("BOUNDARY_ARCHIVE_TOO_LARGE")

        files = {PurePosixPath(member.filename.replace("\\", "/")) for member in members if not member.is_dir()}
        shapefiles = sorted(path for path in files if path.suffix.lower() == ".shp")
        selected = None
        for shapefile in shapefiles:
            siblings = {path.suffix.lower() for path in files if path.parent == shapefile.parent and path.stem == shapefile.stem}
            if {".shp", ".shx", ".dbf"}.issubset(siblings):
                selected = shapefile
                break
        if selected is None:
            raise ValueError("BOUNDARY_SHAPEFILE_COMPONENT_MISSING")

        for member in members:
            target = (destination / PurePosixPath(member.filename.replace("\\", "/"))).resolve()
            if destination != target and destination not in target.parents:
                raise ValueError("BOUNDARY_ARCHIVE_PATH_ESCAPE")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
    return destination / selected


def _polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return [part for item in geometry.geoms for part in _polygon_parts(item)]
    return []


def normalize_boundary_file(path: str | Path, default_crs: str = "EPSG:4326") -> dict:
    frame = gpd.read_file(Path(path))
    if frame.empty:
        raise ValueError("BOUNDARY_EMPTY")
    if frame.crs is None:
        frame = frame.set_crs(default_crs)
    frame = frame.to_crs("EPSG:4326")
    geometry = frame.geometry.make_valid().union_all()
    polygons = [part for part in _polygon_parts(geometry) if not part.is_empty]
    if not polygons:
        raise ValueError("BOUNDARY_POLYGON_REQUIRED")
    normalized = MultiPolygon(polygons)
    min_x, min_y, max_x, max_y = normalized.bounds
    if min_x < -180 or max_x > 180 or min_y < -90 or max_y > 90:
        raise ValueError("BOUNDARY_COORDINATE_OUT_OF_RANGE")
    return mapping(normalized)
