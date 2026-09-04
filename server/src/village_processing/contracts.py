from dataclasses import dataclass
import json
from pathlib import Path, PurePath
from typing import Any
from uuid import UUID


VALID_STEPS = frozenset({"buildings", "roads_water", "contours"})


def _validate_aoi(geometry: Any) -> dict:
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("INVALID_AOI")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise ValueError("INVALID_AOI")

    def walk(value: Any):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            yield float(value[0]), float(value[1])
        elif isinstance(value, list):
            for child in value:
                yield from walk(child)

    points = list(walk(coordinates))
    if len(points) < 4 or any(not (-180 <= x <= 180 and -90 <= y <= 90) for x, y in points):
        raise ValueError("INVALID_AOI")
    return geometry


@dataclass(frozen=True)
class ProcessingParameters:
    building_threshold: float = 0.5
    contour_interval: int = 10
    contour_smoothing: int = 1

    @classmethod
    def from_dict(cls, raw: dict | None) -> "ProcessingParameters":
        raw = raw or {}
        threshold = float(raw.get("building_threshold", 0.5))
        interval = raw.get("contour_interval", 10)
        smoothing = raw.get("contour_smoothing", 1)
        if not 0.1 <= threshold <= 0.95:
            raise ValueError("INVALID_BUILDING_THRESHOLD")
        if isinstance(interval, bool) or interval not in {5, 10}:
            raise ValueError("INVALID_CONTOUR_INTERVAL")
        if isinstance(smoothing, bool) or smoothing not in {0, 1}:
            raise ValueError("INVALID_CONTOUR_SMOOTHING")
        return cls(threshold, int(interval), int(smoothing))


@dataclass(frozen=True)
class ProcessingRequest:
    run_id: str
    village_id: str
    aoi: dict
    requested_steps: tuple[str, ...]
    parameters: ProcessingParameters
    work_dir: Path
    dataset_id: str | None = None
    input_manifest: dict | None = None

    @classmethod
    def from_json(cls, path: Path) -> "ProcessingRequest":
        raw = json.loads(Path(path).read_text("utf-8"))
        run_id = str(raw.get("run_id", ""))
        try:
            UUID(run_id)
        except (ValueError, AttributeError) as exc:
            raise ValueError("INVALID_RUN_ID") from exc
        steps = tuple(raw.get("requested_steps", ()))
        if not steps or any(step not in VALID_STEPS for step in steps):
            raise ValueError("INVALID_PROCESSING_STEP")
        work_dir = Path(str(raw.get("work_dir", "")))
        if work_dir.is_absolute() or not work_dir.parts or ".." in PurePath(work_dir).parts:
            raise ValueError("INVALID_WORK_DIR")
        village_id = str(raw.get("village_id", "")).strip()
        if not village_id:
            raise ValueError("INVALID_VILLAGE_ID")
        return cls(
            run_id=run_id,
            village_id=village_id,
            aoi=_validate_aoi(raw.get("aoi")),
            requested_steps=steps,
            parameters=ProcessingParameters.from_dict(raw.get("parameters")),
            work_dir=work_dir,
            dataset_id=str(raw["dataset_id"]) if raw.get("dataset_id") else None,
            input_manifest=raw.get("input_manifest") if isinstance(raw.get("input_manifest"), dict) else None,
        )


@dataclass(frozen=True)
class ArtifactSummary:
    path: Path
    artifact_type: str
    feature_count: int
    bbox: tuple[float, float, float, float]
    sha256: str
    source: str
    warning_code: str | None = None
