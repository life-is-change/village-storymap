from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Callable

from village_processing.contracts import ArtifactSummary
from .legacy_pipeline import process_tif


def _file_hash(path: Path | None) -> str:
    if path is None:
        return "injected"
    digest = sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class BuildingEngine:
    def __init__(
        self,
        config_path: Path | None = None,
        checkpoint_path: Path | None = None,
        device: str = "cuda:0",
        model=None,
        runner: Callable = process_tif,
    ):
        self.config_path = Path(config_path) if config_path else None
        self.checkpoint_path = Path(checkpoint_path) if checkpoint_path else None
        self.device = device
        if model is None:
            if self.config_path is None or self.checkpoint_path is None:
                raise ValueError("MODEL_PATHS_REQUIRED")
            from mmdet.apis import init_detector

            model = init_detector(str(self.config_path), str(self.checkpoint_path), device=device)
        self.model = model
        self.runner = runner
        self.config_sha256 = _file_hash(self.config_path)
        self.checkpoint_sha256 = _file_hash(self.checkpoint_path)

    def process(
        self,
        tif_path: Path,
        output_geojson: Path,
        score_threshold: float,
        batch_size: int = 1,
    ) -> ArtifactSummary:
        del batch_size
        output_geojson = Path(output_geojson)
        output_geojson.parent.mkdir(parents=True, exist_ok=True)
        try:
            result_path = Path(
                self.runner(
                    model=self.model,
                    tif_path=Path(tif_path),
                    output_geojson=output_geojson,
                    score_threshold=score_threshold,
                    batch_size=1,
                    tile_size=1536,
                    overlap=384,
                )
            )
            payload = json.loads(result_path.read_text("utf-8"))
            if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
                raise ValueError("INVALID_BUILDING_OUTPUT")
            metadata = {
                "type": "building_model",
                "config_sha256": self.config_sha256,
                "checkpoint_sha256": self.checkpoint_sha256,
                "score_threshold": score_threshold,
                "tile_size": 1536,
                "overlap": 384,
                "batch_size": 1,
                "device": self.device,
            }
            for feature in payload["features"]:
                feature.setdefault("properties", {})["source"] = "building_model"
            output_geojson.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
            digest = sha256(output_geojson.read_bytes()).hexdigest()
            points = []

            def collect(value: Any):
                if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
                    points.append((float(value[0]), float(value[1])))
                elif isinstance(value, list):
                    for child in value:
                        collect(child)

            for feature in payload["features"]:
                collect(feature.get("geometry", {}).get("coordinates", []))
            bbox = (
                (min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points))
                if points
                else (0.0, 0.0, 0.0, 0.0)
            )
            return ArtifactSummary(
                path=output_geojson,
                artifact_type="buildings",
                feature_count=len(payload["features"]),
                bbox=bbox,
                sha256=digest,
                source=json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
            )
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower():
                output_geojson.unlink(missing_ok=True)
                raise RuntimeError("GPU_OUT_OF_MEMORY") from exc
            raise
