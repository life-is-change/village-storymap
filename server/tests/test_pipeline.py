import json
from pathlib import Path
from uuid import uuid4

from village_processing.contracts import ArtifactSummary, ProcessingParameters, ProcessingRequest
from village_processing.pipeline import run_pipeline


AOI = {
    "type": "Polygon",
    "coordinates": [[[113.661, 23.676], [113.665, 23.676], [113.665, 23.679], [113.661, 23.679], [113.661, 23.676]]],
}


class FakeCatalog:
    def resolve(self, village_id):
        return object()


class FakeProcessors:
    def _artifact(self, request, artifact_type):
        path = request.work_dir / f"{artifact_type}.geojson"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": "FeatureCollection", "features": []}), "utf-8")
        return ArtifactSummary(path, artifact_type, 0, (0, 0, 0, 0), "abc123", "test")

    def buildings(self, request, dataset):
        return self._artifact(request, "buildings")

    def roads_water(self, request, dataset):
        return [self._artifact(request, name) for name in ("roads", "waterways", "water_areas")]

    def contours(self, request, dataset):
        return self._artifact(request, "contours")


def test_pipeline_writes_manifest_after_all_requested_steps(tmp_path: Path):
    request = ProcessingRequest(
        run_id=str(uuid4()),
        village_id="mibu",
        aoi=AOI,
        requested_steps=("buildings", "roads_water", "contours"),
        parameters=ProcessingParameters(0.35, 5, 1),
        work_dir=tmp_path / "run",
    )

    manifest = run_pipeline(request, FakeCatalog(), FakeProcessors())

    assert manifest.status == "completed"
    assert {artifact.artifact_type for artifact in manifest.artifacts} == {
        "buildings", "roads", "waterways", "water_areas", "contours"
    }
    assert (request.work_dir / "manifest.json").is_file()
