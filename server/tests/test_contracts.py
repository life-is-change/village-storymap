import json
from pathlib import Path
from uuid import uuid4

import pytest

from village_processing.contracts import ProcessingRequest


AOI = {
    "type": "Polygon",
    "coordinates": [[[113.661, 23.676], [113.665, 23.676], [113.665, 23.679], [113.661, 23.679], [113.661, 23.676]]],
}


def write_request(path: Path, **overrides):
    payload = {
        "run_id": str(uuid4()),
        "village_id": "mibu",
        "aoi": AOI,
        "requested_steps": ["buildings", "roads_water", "contours"],
        "parameters": {"building_threshold": 0.5, "contour_interval": 10, "contour_smoothing": 1},
        "work_dir": "runs/example",
    }
    payload.update(overrides)
    path.write_text(json.dumps(payload), "utf-8")
    return path


def test_processing_request_accepts_supported_values(tmp_path: Path):
    request = ProcessingRequest.from_json(write_request(
        tmp_path / "request.json",
        dataset_id="dataset-1",
        input_manifest={"files": {}},
    ))

    assert request.village_id == "mibu"
    assert request.parameters.contour_interval == 10
    assert request.requested_steps == ("buildings", "roads_water", "contours")
    assert request.dataset_id == "dataset-1"
    assert request.input_manifest == {"files": {}}


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"run_id": "not-a-uuid"}, "INVALID_RUN_ID"),
        ({"requested_steps": ["shell"]}, "INVALID_PROCESSING_STEP"),
        ({"aoi": {"type": "Point", "coordinates": [113.0, 23.0]}}, "INVALID_AOI"),
        ({"parameters": {"building_threshold": 0.99}}, "INVALID_BUILDING_THRESHOLD"),
        ({"parameters": {"contour_interval": 20}}, "INVALID_CONTOUR_INTERVAL"),
        ({"parameters": {"contour_smoothing": 2}}, "INVALID_CONTOUR_SMOOTHING"),
        ({"work_dir": "../escape"}, "INVALID_WORK_DIR"),
    ],
)
def test_processing_request_rejects_unsafe_values(tmp_path: Path, overrides, code):
    with pytest.raises(ValueError, match=code):
        ProcessingRequest.from_json(write_request(tmp_path / "request.json", **overrides))
