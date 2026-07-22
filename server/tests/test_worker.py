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
