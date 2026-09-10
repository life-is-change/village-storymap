import asyncio
from dataclasses import dataclass
from pathlib import Path

import pytest

from village_processing.facade.models import FacadeRun
from village_processing.facade.pipeline import FacadeCancelRequested, FacadePipeline
from village_processing.facade.worker import FacadeWorker


def facade_run(status="claimed_rectification", revision=0):
    return FacadeRun.from_row({
        "id": "run-1",
        "owner_id": "user-1",
        "photo_id": 4,
        "object_code": "B-1",
        "space_id": "current",
        "status": status,
        "generation_revision": revision,
        "source_photo_path": "project/village/current/building/front.jpg",
        "crop_top": 0.18,
        "roof_type": "gable",
        "building_width": 10,
        "building_depth": 8,
    })


@dataclass(frozen=True)
class Rectified:
    source: Path
    preview: Path
    building_mask: Path
    diagnostics: Path


@dataclass(frozen=True)
class Generated:
    texture: Path
    glb: Path
    manifest: Path
    building: dict


class FakeProcessor:
    def __init__(self, *, fail_generation=False):
        self.events = []
        self.fail_generation = fail_generation

    def rectify(self, source, job_dir):
        self.events.append("rectify")
        artifact_dir = job_dir / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        values = {
            "source": ("rectified_source.png", b"source"),
            "preview": ("rectified_preview.jpg", b"preview"),
            "building_mask": ("building_mask_rectified.png", b"mask"),
            "diagnostics": ("rectification_diagnostics.json", b"{}"),
        }
        paths = {}
        for key, (name, content) in values.items():
            paths[key] = artifact_dir / name
            paths[key].write_bytes(content)
        return Rectified(**paths)

    def prepare_texture(self, rectified, mask, job_dir, *, crop_top, building):
        self.events.append("prepare")
        output = job_dir / "artifacts" / "facade_texture.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"texture")
        return output, dict(building)

    def generate_prepared(self, texture, job_dir, building, *, roof_analysis=None):
        self.events.append("blender")
        if self.fail_generation:
            raise RuntimeError("BLENDER_FAILED")
        glb = job_dir / "artifacts" / "building.glb"
        manifest = job_dir / "artifacts" / "model_manifest.json"
        glb.write_bytes(b"glTF" + b"\x00" * 24)
        manifest.write_text("{}", encoding="utf-8")
        return Generated(texture, glb, manifest, dict(building))


class FakeGateway:
    def __init__(self, run=None):
        self.run = run
        self.events = []
        self.cancel_requested = False
        self.renew_count = 0
        self.previous_glb = "user-1/run-1/generation-r1/building.glb"

    def claim(self, worker_id):
        self.events.append("claim")
        value, self.run = self.run, None
        return value

    def download_photo(self, run, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"\xff\xd8\xffphoto")
        self.events.append("download_photo")
        return destination

    def download_artifact(self, run, artifact_type, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"source" if artifact_type == "rectified_source" else b"mask")
        self.events.append(f"restore:{artifact_type}")
        return destination

    def upload_artifact(self, run, worker_id, phase, artifact_type, path, content_type, source):
        self.events.append(f"upload:{artifact_type}")
        return f"{run.owner_id}/{run.run_id}/{phase}/{path.name}"

    def publish_rectification(self, run_id, worker_id, artifacts):
        self.events.append("publish_rectification")
        self.rectification_artifacts = artifacts

    def complete_generation(self, run, worker_id, model, source):
        self.events.append("publish_generation")
        self.previous_glb = f"user-1/run-1/generation-r{run.generation_revision}/building.glb"

    def set_state(self, run_id, worker_id, status, **values):
        self.events.append(status)

    def is_cancel_requested(self, run_id):
        return self.cancel_requested

    def renew(self, run_id, worker_id):
        self.renew_count += 1

    def assert_lease(self, run_id):
        return None

    def fail(self, run_id, worker_id, code, message):
        self.events.append(f"fail:{code}")

    def retry_or_fail(self, run_id, worker_id, code, message):
        self.events.append(f"retry:{code}")
        return "queued_generation"

    def cancel(self, run_id, worker_id):
        self.events.append("canceled")

    def heartbeat(self, worker_id, state, version):
        self.events.append("heartbeat")


def test_rectification_uploads_required_artifacts_then_waits_for_crop(tmp_path):
    gateway = FakeGateway()
    pipeline = FacadePipeline(gateway, FakeProcessor(), tmp_path, "linux-4090-01")

    pipeline.rectify(facade_run())

    assert gateway.events[-1] == "publish_rectification"
    assert {item["artifact_type"] for item in gateway.rectification_artifacts} >= {
        "rectified_source", "rectified_preview", "building_mask"
    }


def test_awaiting_crop_is_never_claimed_or_renewed(tmp_path):
    gateway = FakeGateway(run=None)
    worker = FacadeWorker(gateway, object(), "linux-4090-01", lease_renew_seconds=0.001)

    assert asyncio.run(worker.run_once()) is False
    assert gateway.renew_count == 0


def test_generation_restores_missing_rectification_artifacts(tmp_path):
    gateway = FakeGateway()
    processor = FakeProcessor()
    pipeline = FacadePipeline(gateway, processor, tmp_path, "linux-4090-01")

    pipeline.generate(facade_run("claimed_generation", revision=2))

    assert "restore:rectified_source" in gateway.events
    assert "restore:building_mask" in gateway.events
    assert gateway.events[-1] == "publish_generation"


def test_regeneration_failure_preserves_previous_glb_record(tmp_path):
    run = facade_run("claimed_generation", revision=2)
    gateway = FakeGateway(run=run)
    pipeline = FacadePipeline(gateway, FakeProcessor(fail_generation=True), tmp_path, "linux-4090-01")
    worker = FacadeWorker(gateway, pipeline, "linux-4090-01")

    assert asyncio.run(worker.run_once()) is True
    assert gateway.previous_glb.endswith("generation-r1/building.glb")
    assert "publish_generation" not in gateway.events
    assert "retry:BLENDER_FAILED" in gateway.events


def test_busy_worker_emits_heartbeat_during_processing(tmp_path):
    gateway = FakeGateway(run=facade_run())
    pipeline = FacadePipeline(gateway, FakeProcessor(), tmp_path, "linux-4090-01")
    worker = FacadeWorker(gateway, pipeline, "linux-4090-01", heartbeat_seconds=0.001)

    assert asyncio.run(worker.run_once()) is True
    assert "heartbeat" in gateway.events


def test_expired_claim_can_resume_with_deterministic_paths(tmp_path):
    pipeline = FacadePipeline(FakeGateway(), FakeProcessor(), tmp_path, "linux-4090-01")
    run = facade_run()

    assert pipeline.work_dir(run) == tmp_path / "facade-runs" / "run-1"
    assert pipeline.work_dir(run) == pipeline.work_dir(run)


def test_cancel_requested_stops_before_blender(tmp_path):
    gateway = FakeGateway()
    processor = FakeProcessor()
    pipeline = FacadePipeline(gateway, processor, tmp_path, "linux-4090-01")
    original_prepare = processor.prepare_texture

    def prepare_then_cancel(*args, **kwargs):
        result = original_prepare(*args, **kwargs)
        gateway.cancel_requested = True
        return result

    processor.prepare_texture = prepare_then_cancel

    try:
        pipeline.generate(facade_run("claimed_generation", revision=2))
    except RuntimeError as exc:
        assert str(exc) == "FACADE_CANCEL_REQUESTED"
    else:
        raise AssertionError("canceled generation reached Blender")
    assert "blender" not in processor.events


def test_cancel_request_wins_over_a_concurrent_lost_lease(tmp_path):
    gateway = FakeGateway()
    gateway.cancel_requested = True
    gateway.assert_lease = lambda _run_id: (_ for _ in ()).throw(RuntimeError("FACADE_LEASE_LOST"))
    pipeline = FacadePipeline(gateway, FakeProcessor(), tmp_path, "linux-4090-01")

    with pytest.raises(FacadeCancelRequested):
        pipeline._check_canceled(facade_run())
