import json
from pathlib import Path
from threading import Event, Lock, Thread

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds

from village_processing.building.engine import BuildingEngine
from village_processing.building import legacy_pipeline
from village_processing.building.service import resolve_manifest_path


def write_feature_collection(path: Path):
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"score": 0.9},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[113.0, 23.0], [113.001, 23.0], [113.001, 23.001], [113.0, 23.001], [113.0, 23.0]]],
                        },
                    }
                ],
            }
        ),
        "utf-8",
    )


def test_engine_reuses_loaded_model_and_forces_batch_one(tmp_path: Path):
    calls = []

    def runner(**kwargs):
        calls.append(kwargs)
        write_feature_collection(kwargs["output_geojson"])
        return kwargs["output_geojson"]

    model = object()
    engine = BuildingEngine(model=model, runner=runner, device="cuda:0")
    artifact = engine.process(tmp_path / "in.tif", tmp_path / "buildings.geojson", 0.35, batch_size=8)

    assert engine.model is model
    assert calls[0]["model"] is model
    assert calls[0]["batch_size"] == 1
    assert artifact.path.name == "buildings.geojson"
    assert artifact.feature_count == 1
    assert '"batch_size":1' in artifact.source


def test_engine_removes_partial_output_on_gpu_oom(tmp_path: Path):
    output = tmp_path / "buildings.geojson"

    def runner(**kwargs):
        output.write_text("partial", "utf-8")
        raise RuntimeError("CUDA out of memory")

    engine = BuildingEngine(model=object(), runner=runner)

    with pytest.raises(RuntimeError, match="GPU_OUT_OF_MEMORY"):
        engine.process(tmp_path / "in.tif", output, 0.35)
    assert not output.exists()


def test_service_manifest_must_be_under_work_root(tmp_path: Path):
    work_root = tmp_path / "work"
    work_root.mkdir()
    manifest = work_root / "run" / "building.json"
    manifest.parent.mkdir()
    manifest.touch()

    assert resolve_manifest_path(work_root, manifest) == manifest.resolve()
    with pytest.raises(ValueError, match="MANIFEST_PATH_ESCAPE"):
        resolve_manifest_path(work_root, tmp_path / "outside.json")


def test_ready_loads_the_engine_and_reports_device(monkeypatch):
    from types import SimpleNamespace
    from village_processing.building import service

    monkeypatch.setattr(service, "_get_engine", lambda: SimpleNamespace(device="cuda:0"))

    assert service.ready() == {
        "ok": True,
        "model_loaded": True,
        "device": "cuda:0",
    }


def test_ready_returns_stable_503_without_local_path(monkeypatch):
    from fastapi import HTTPException
    from village_processing.building import service

    def fail():
        raise RuntimeError("cannot load /data/private/model.pth")

    monkeypatch.setattr(service, "_get_engine", fail)
    with pytest.raises(HTTPException) as captured:
        service.ready()

    assert captured.value.status_code == 503
    assert captured.value.detail == "MODEL_NOT_READY"
    assert "/data/" not in str(captured.value.detail)


def test_engine_initialization_is_serialized(monkeypatch):
    from village_processing.building import service

    initialization_started = Event()
    second_initialization_started = Event()
    allow_initialization_to_finish = Event()
    calls_lock = Lock()
    calls = 0

    class FakeEngine:
        device = "cuda:0"

        def __init__(self, *_args, **_kwargs):
            nonlocal calls
            with calls_lock:
                calls += 1
                if calls == 1:
                    initialization_started.set()
                else:
                    second_initialization_started.set()
            assert allow_initialization_to_finish.wait(timeout=2)

    monkeypatch.setenv("PLATFORM_MODEL_CONFIG", "/data/model.py")
    monkeypatch.setenv("PLATFORM_MODEL_CHECKPOINT", "/data/model.pth")
    monkeypatch.setattr(service, "BuildingEngine", FakeEngine)
    monkeypatch.setattr(service, "_engine", None)

    results = []
    first = Thread(target=lambda: results.append(service._get_engine()))
    second = Thread(target=lambda: results.append(service._get_engine()))
    first.start()
    assert initialization_started.wait(timeout=1)
    second.start()

    initialized_twice = second_initialization_started.wait(timeout=0.25)
    allow_initialization_to_finish.set()
    first.join(timeout=2)
    second.join(timeout=2)

    assert not initialized_twice
    assert calls == 1
    assert len(results) == 2
    assert results[0] is results[1]


def test_legacy_pipeline_converts_mask_to_wgs84_geojson(tmp_path: Path, monkeypatch):
    source = tmp_path / "input.tif"
    output = tmp_path / "output.geojson"
    image = np.zeros((3, 256, 256), dtype=np.uint8)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=256,
        height=256,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(113.0, 23.0, 113.01, 23.01, 256, 256),
    ) as dataset:
        dataset.write(image)
    instance = np.zeros((256, 256), dtype=bool)
    instance[110:150, 110:160] = True
    detection = ([np.array([[110, 110, 160, 150, 0.9]], dtype=np.float32)], [[instance]])
    monkeypatch.setattr(legacy_pipeline, "inference_detector", lambda model, images: [detection])

    legacy_pipeline.process_tif(
        model=object(),
        tif_path=source,
        output_geojson=output,
        tile_size=256,
        overlap=64,
        batch_size=1,
    )

    payload = json.loads(output.read_text("utf-8"))
    assert len(payload["features"]) == 1
    assert payload["features"][0]["geometry"]["type"] == "Polygon"


def test_legacy_pipeline_preserves_l_shaped_building_footprint(tmp_path: Path, monkeypatch):
    source = tmp_path / "input-l.tif"
    output = tmp_path / "output-l.geojson"
    image = np.zeros((3, 256, 256), dtype=np.uint8)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=256,
        height=256,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(113.0, 23.0, 113.01, 23.01, 256, 256),
    ) as dataset:
        dataset.write(image)

    instance = np.zeros((256, 256), dtype=bool)
    instance[105:165, 105:130] = True
    instance[140:165, 105:175] = True
    detection = ([np.array([[105, 105, 175, 165, 0.9]], dtype=np.float32)], [[instance]])
    monkeypatch.setattr(legacy_pipeline, "inference_detector", lambda model, images: [detection])

    legacy_pipeline.process_tif(
        model=object(),
        tif_path=source,
        output_geojson=output,
        tile_size=256,
        overlap=64,
        batch_size=1,
    )

    payload = json.loads(output.read_text("utf-8"))
    ring = payload["features"][0]["geometry"]["coordinates"][0]
    assert len(ring) - 1 >= 6, "L-shaped roofs must not be expanded to one bounding rectangle"


def test_legacy_regularizer_outputs_rectangles_and_bounded_orthogonal_complexes():
    noisy_rectangle = np.array(
        [
            [[0, 0]], [[20, 0]], [[40, 1]], [[60, 0]], [[60, 20]],
            [[59, 40]], [[40, 40]], [[20, 39]], [[0, 40]], [[0, 20]],
        ],
        dtype=np.float32,
    )
    l_shape = np.array(
        [
            [[0, 0]], [[60, 0]], [[60, 20]], [[25, 20]],
            [[25, 60]], [[0, 60]],
        ],
        dtype=np.float32,
    )

    rectangle_points, rectangle_method, _ = legacy_pipeline._regularize_contour(noisy_rectangle)
    l_points, l_method, _ = legacy_pipeline._regularize_contour(l_shape)

    assert rectangle_method == "rectangle"
    assert len(rectangle_points) == 4
    assert l_method == "orthogonal_complex"
    assert len(l_points) == 6
