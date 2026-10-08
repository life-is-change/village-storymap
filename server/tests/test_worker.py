import asyncio
from dataclasses import dataclass

from village_processing.worker import Worker


@dataclass
class Run:
    run_id: str = "11111111-2222-4333-8444-555555555555"
    owner_id: str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


@dataclass
class Manifest:
    artifacts: tuple = ("artifact",)
    warnings: tuple = ()


class FakeGateway:
    def __init__(self):
        self.events = []
        self.renew_count = 0

    def claim(self, worker_id):
        self.events.append("claim")
        return Run()

    def set_running(self, run_id, worker_id):
        self.events.append("running")

    def is_cancel_requested(self, run_id):
        return False

    def renew(self, run_id, worker_id):
        self.renew_count += 1

    def upload_artifact(self, owner_id, run_id, worker_id, artifact):
        self.events.append("upload")

    def complete(self, run_id, worker_id, warnings):
        self.events.append("complete")

    def fail(self, *args):
        self.events.append("fail")

    def heartbeat(self, worker_id, state, version):
        self.events.append("heartbeat")


def test_worker_claims_runs_pipeline_uploads_then_completes():
    gateway = FakeGateway()
    worker = Worker(gateway, lambda run: Manifest(), worker_id="win11-pilot")

    assert asyncio.run(worker.run_once()) is True
    assert gateway.events == ["claim", "running", "upload", "complete"]


def test_worker_renews_lease_during_long_pipeline():
    gateway = FakeGateway()

    def slow_pipeline(run):
        import time
        time.sleep(0.04)
        return Manifest()

    worker = Worker(
        gateway, slow_pipeline, worker_id="win11-pilot", lease_renew_seconds=0.01
    )

    asyncio.run(worker.run_once())
    assert gateway.renew_count >= 1


def test_worker_cycle_survives_a_transient_queue_error_and_can_poll_again():
    class FlakyGateway(FakeGateway):
        def __init__(self):
            super().__init__()
            self.claim_count = 0

        def claim(self, worker_id):
            self.claim_count += 1
            if self.claim_count == 1:
                raise RuntimeError("temporary network failure")
            return None

        def heartbeat(self, worker_id, state, version):
            self.events.append("heartbeat")

    gateway = FlakyGateway()
    worker = Worker(gateway, lambda run: Manifest(), worker_id="win11-pilot")

    assert asyncio.run(worker.run_cycle()) is False
    assert asyncio.run(worker.run_cycle()) is False
    assert gateway.claim_count == 2
    assert gateway.events == ["heartbeat", "heartbeat"]


def test_worker_keeps_heartbeat_fresh_while_processing():
    import time

    class BusyGateway(FakeGateway):
        def heartbeat(self, worker_id, state, version):
            self.events.append(f"heartbeat:{state}")

    gateway = BusyGateway()

    def slow_pipeline(run):
        time.sleep(0.04)
        return Manifest()

    worker = Worker(gateway, slow_pipeline, worker_id="win11-pilot", lease_renew_seconds=0.01)
    asyncio.run(worker.run_once())
    assert "heartbeat:busy" in gateway.events


def test_status_publication_failure_does_not_block_queue():
    gateway = FakeGateway()

    def failing_publisher():
        raise RuntimeError("temporary status RPC failure")

    worker = Worker(gateway, lambda run: Manifest(), "win11-pilot", source_status_publisher=failing_publisher)
    assert asyncio.run(worker.run_cycle()) is True
    assert "complete" in gateway.events


def test_source_disappears_after_claim_reports_specific_failure_code():
    class RecordingGateway(FakeGateway):
        def fail(self, run_id, worker_id, code, message):
            self.failed = (code, message)

    gateway = RecordingGateway()

    def missing_source(run):
        raise FileNotFoundError("LOCAL_IMAGERY_MISSING")

    assert asyncio.run(Worker(gateway, missing_source, "worker-1").run_once()) is True
    assert gateway.failed == ("LOCAL_IMAGERY_MISSING", "LOCAL_IMAGERY_MISSING")


def test_processing_failure_does_not_publish_a_local_file_path():
    class RecordingGateway(FakeGateway):
        def fail(self, run_id, worker_id, code, message):
            self.failed = (code, message)

    gateway = RecordingGateway()

    def unreadable_source(_run):
        raise RuntimeError("/srv/village-platform/data/private/imagery.tif: file not found")

    assert asyncio.run(Worker(gateway, unreadable_source, "worker-1").run_once()) is True
    assert gateway.failed == ("PROCESSING_FAILED", "处理失败，请联系管理员并提供任务编号。")
