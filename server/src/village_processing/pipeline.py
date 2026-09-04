from dataclasses import asdict, dataclass, replace
import json
from pathlib import Path
from typing import Any

import httpx

from village_processing.catalog import VillageDataset
from village_processing.contracts import ArtifactSummary, ProcessingRequest
from village_processing.processors.contours import generate_contours
from village_processing.processors.osm import extract_osm_layers
from village_processing.raster import crop_imagery


def resolve_dataset(request: ProcessingRequest, local_catalog, remote_resolver):
    if request.dataset_id:
        if remote_resolver is None:
            raise ValueError("REMOTE_DATASET_RESOLVER_REQUIRED")
        return remote_resolver.resolve(request, request.work_dir)
    if request.village_id != "mibu":
        raise ValueError("DATASET_ID_REQUIRED")
    return local_catalog.resolve("mibu")


@dataclass(frozen=True)
class RunManifest:
    run_id: str
    village_id: str
    status: str
    artifacts: tuple[ArtifactSummary, ...]
    warnings: tuple[str, ...]
    stages: dict[str, str]
    error: str | None = None


def _write_manifest(request: ProcessingRequest, manifest: RunManifest) -> None:
    payload = asdict(manifest)
    for artifact in payload["artifacts"]:
        artifact["path"] = str(artifact["path"])
    target = request.work_dir / "manifest.json"
    partial = request.work_dir / "manifest.partial.json"
    partial.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    partial.replace(target)


def run_pipeline(request: ProcessingRequest, catalog, processors, remote_resolver=None) -> RunManifest:
    request.work_dir.mkdir(parents=True, exist_ok=True)
    dataset = resolve_dataset(request, catalog, remote_resolver)
    artifacts: list[ArtifactSummary] = []
    warnings: list[str] = []
    stages = {step: "pending" for step in request.requested_steps}
    try:
        if "buildings" in request.requested_steps:
            stages["buildings"] = "running"
            artifacts.append(processors.buildings(request, dataset))
            stages["buildings"] = "completed"
        if "roads_water" in request.requested_steps:
            stages["roads_water"] = "running"
            osm_artifacts = processors.roads_water(request, dataset)
            artifacts.extend(osm_artifacts)
            warnings.extend(item.warning_code for item in osm_artifacts if item.warning_code)
            stages["roads_water"] = "completed"
        if "contours" in request.requested_steps:
            stages["contours"] = "running"
            contour = processors.contours(request, dataset)
            artifacts.append(contour)
            if contour.warning_code:
                warnings.append(contour.warning_code)
            stages["contours"] = "completed"
        manifest = RunManifest(
            request.run_id, request.village_id, "completed", tuple(artifacts),
            tuple(warnings), stages,
        )
    except Exception as exc:
        manifest = RunManifest(
            request.run_id, request.village_id, "failed", tuple(artifacts),
            tuple(warnings), stages, f"{type(exc).__name__}: {exc}",
        )
        _write_manifest(request, manifest)
        raise
    _write_manifest(request, manifest)
    return manifest


class NativeProcessors:
    def __init__(self, work_root: Path, building_url: str = "http://127.0.0.1:8021"):
        self.work_root = Path(work_root).resolve()
        self.building_url = building_url.rstrip("/")

    def _relative_to_work_root(self, path: Path) -> str:
        try:
            return str(Path(path).resolve().relative_to(self.work_root))
        except ValueError as exc:
            raise ValueError("WORK_PATH_ESCAPE") from exc

    def buildings(self, request: ProcessingRequest, dataset: VillageDataset) -> ArtifactSummary:
        input_tif = request.work_dir / "building-input.tif"
        output = request.work_dir / "buildings.geojson"
        crop_imagery(dataset.imagery, request.aoi, input_tif)
        building_manifest = request.work_dir / "building-request.json"
        building_manifest.write_text(json.dumps({
            "input_tif": self._relative_to_work_root(input_tif),
            "output_geojson": self._relative_to_work_root(output),
            "score_threshold": request.parameters.building_threshold,
        }), "utf-8")
        response = httpx.post(
            f"{self.building_url}/process",
            json={"manifest_path": str(building_manifest.resolve())},
            timeout=600,
        )
        response.raise_for_status()
        item: dict[str, Any] = response.json()
        return ArtifactSummary(
            path=Path(item["path"]),
            artifact_type="buildings",
            feature_count=int(item["feature_count"]),
            bbox=tuple(item["bbox"]),
            sha256=item["sha256"],
            source=item["source"],
        )

    def roads_water(self, request: ProcessingRequest, dataset: VillageDataset) -> list[ArtifactSummary]:
        return extract_osm_layers(
            dataset.osm, request.aoi, request.work_dir / "osm", dataset.osm_snapshot
        )

    def contours(self, request: ProcessingRequest, dataset: VillageDataset) -> ArtifactSummary:
        return generate_contours(
            dataset.dem,
            request.aoi,
            request.work_dir / "contours.geojson",
            request.parameters.contour_interval,
            request.parameters.contour_smoothing,
            dataset.dem_source,
        )


def resolve_run_request(request: ProcessingRequest, work_root: Path) -> ProcessingRequest:
    root = Path(work_root).resolve()
    target = (root / request.work_dir).resolve()
    if target != root and root not in target.parents:
        raise ValueError("WORK_PATH_ESCAPE")
    return replace(request, work_dir=target)
