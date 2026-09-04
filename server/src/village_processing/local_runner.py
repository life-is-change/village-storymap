"""Local two-runtime orchestration for producing an administrator V0 package."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
from uuid import uuid4

from shapely.geometry import shape

from .boundary import extract_boundary_archive, normalize_boundary_file
from .catalog import DatasetCatalog, VillageDataset
from .contracts import ProcessingParameters, ProcessingRequest
from .pipeline import NativeProcessors, run_pipeline
from .preview import generate_preview
from .raster import crop_imagery
from .v0_package import PackageResult, build_v0_package


def safe_job_slug(value: str) -> str:
    raw = str(value or "").strip()
    if not raw or ".." in raw or "/" in raw or "\\" in raw:
        raise ValueError("LOCAL_VILLAGE_SLUG_INVALID")
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw).strip("-").lower()
    if not slug:
        raise ValueError("LOCAL_VILLAGE_SLUG_INVALID")
    return slug


@dataclass(frozen=True)
class LocalToolConfig:
    tool_root: Path
    imagery: Path
    boundary: Path
    osm: Path
    dem: Path
    model_config: Path
    model_checkpoint: Path
    village_name: str
    village_slug: str
    building_threshold: float = 0.5
    contour_interval: int = 10
    contour_smoothing: int = 1

    @classmethod
    def from_dict(cls, raw: dict) -> "LocalToolConfig":
        name = str(raw.get("village_name", "")).strip()
        if not name:
            raise ValueError("LOCAL_VILLAGE_NAME_REQUIRED")
        paths = {}
        for key in ("tool_root", "imagery", "boundary", "osm", "dem", "model_config", "model_checkpoint"):
            value = Path(str(raw.get(key, ""))).resolve()
            if key == "tool_root":
                if not value.is_dir():
                    raise ValueError("LOCAL_TOOL_ROOT_MISSING")
            elif not value.is_file():
                raise ValueError(f"LOCAL_SOURCE_MISSING: {key}")
            paths[key] = value
        parameters = ProcessingParameters.from_dict({
            "building_threshold": float(raw.get("building_threshold", 0.5)),
            "contour_interval": int(raw.get("contour_interval", 10)),
            "contour_smoothing": int(raw.get("contour_smoothing", 1)),
        })
        return cls(
            **paths,
            village_name=name,
            village_slug=safe_job_slug(raw.get("village_slug", "")),
            building_threshold=parameters.building_threshold,
            contour_interval=parameters.contour_interval,
            contour_smoothing=parameters.contour_smoothing,
        )


def staged_runtime_check(command: list[str], timeout_seconds: float = 20) -> dict:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": "RUNTIME_CHECK_TIMEOUT", "detail": ""}
    detail = (completed.stdout + "\n" + completed.stderr).strip()
    return {
        "ok": completed.returncode == 0,
        "code": "OK" if completed.returncode == 0 else "RUNTIME_CHECK_FAILED",
        "detail": detail[-4000:],
    }


def _normalized_boundary(config: LocalToolConfig, job_dir: Path) -> dict:
    source = config.boundary
    if source.suffix.lower() == ".zip":
        source = extract_boundary_archive(source, job_dir / "boundary-source")
    return normalize_boundary_file(source)


def run_local_v0(config: LocalToolConfig, building_url: str = "http://127.0.0.1:8021") -> PackageResult:
    work_root = (config.tool_root / "work").resolve()
    output_root = (config.tool_root / "output").resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    output_root.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid4())
    job_dir = work_root / run_id
    job_dir.mkdir()
    boundary = _normalized_boundary(config, job_dir)
    bounds = tuple(float(value) for value in shape(boundary).bounds)
    boundary_path = job_dir / "boundary.geojson"
    boundary_path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": boundary}],
    }, ensure_ascii=False), "utf-8")

    dataset = VillageDataset(
        village_id=config.village_slug,
        display_name=config.village_name,
        imagery=config.imagery,
        dem=config.dem,
        osm=config.osm,
        bounds=bounds,
        model_config=config.model_config,
        model_checkpoint=config.model_checkpoint,
        osm_snapshot="local-source",
        dem_source="Copernicus DEM",
    )
    request = ProcessingRequest(
        run_id=run_id,
        village_id=config.village_slug,
        aoi=boundary,
        requested_steps=("buildings", "roads_water", "contours"),
        parameters=ProcessingParameters(
            config.building_threshold,
            config.contour_interval,
            config.contour_smoothing,
        ),
        work_dir=job_dir,
    )
    catalog = DatasetCatalog({config.village_slug: dataset})
    # run_pipeline normally requires a dataset id for villages other than mibu;
    # this local catalog is already explicit, so use the practice-compatible id.
    request = ProcessingRequest(**{**request.__dict__, "village_id": "mibu"})
    catalog = DatasetCatalog({"mibu": dataset})
    manifest = run_pipeline(request, catalog, NativeProcessors(work_root, building_url))
    artifacts = {item.artifact_type: item.path for item in manifest.artifacts}

    imagery_tif = job_dir / "imagery-cropped.tif"
    crop_imagery(config.imagery, boundary, imagery_tif, buffer_meters=0)
    preview_root = job_dir / "preview-assets"
    generate_preview(imagery_tif, preview_root, config.village_slug, config.village_name)
    imagery_webp = preview_root / "villages" / config.village_slug / "preview.webp"
    return build_v0_package(
        output_root=output_root,
        village_name=config.village_name,
        village_slug=config.village_slug,
        bounds=bounds,
        parameters={
            "building_threshold": config.building_threshold,
            "contour_interval": config.contour_interval,
            "contour_smoothing": config.contour_smoothing,
        },
        source_paths={
            "boundary": boundary_path,
            "imagery": imagery_webp,
            "buildings": artifacts["buildings"],
            "roads": artifacts["roads"],
            "waterways": artifacts["waterways"],
            "water_areas": artifacts["water_areas"],
            "contours": artifacts["contours"],
        },
    )
