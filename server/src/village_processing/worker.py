import asyncio
import contextlib
from typing import Callable


class CancelRequested(Exception):
    pass


def error_code(error: Exception) -> str:
    value = str(error)
    if value and value == value.upper() and " " not in value and len(value) <= 64:
        return value
    return "PROCESSING_FAILED"


class Worker:
    def __init__(
        self,
        gateway,
        pipeline: Callable,
        worker_id: str,
        lease_renew_seconds: float = 30,
    ):
        self.gateway = gateway
        self.pipeline = pipeline
        self.worker_id = worker_id
        self.lease_renew_seconds = lease_renew_seconds

    async def _renew_until_done(self, run_id: str) -> None:
        while True:
            await asyncio.sleep(self.lease_renew_seconds)
            await asyncio.to_thread(self.gateway.renew, run_id, self.worker_id)

    async def run_once(self) -> bool:
        run = await asyncio.to_thread(self.gateway.claim, self.worker_id)
        if run is None:
            return False
        renew_task = asyncio.create_task(self._renew_until_done(run.run_id))
        try:
            if await asyncio.to_thread(self.gateway.is_cancel_requested, run.run_id):
                raise CancelRequested()
            await asyncio.to_thread(self.gateway.set_running, run.run_id, self.worker_id)
            manifest = await asyncio.to_thread(self.pipeline, run)
            if await asyncio.to_thread(self.gateway.is_cancel_requested, run.run_id):
                raise CancelRequested()
            for artifact in manifest.artifacts:
                await asyncio.to_thread(
                    self.gateway.upload_artifact,
                    run.owner_id,
                    run.run_id,
                    self.worker_id,
                    artifact,
                )
            await asyncio.to_thread(
                self.gateway.complete, run.run_id, self.worker_id, manifest.warnings
            )
        except CancelRequested:
            await asyncio.to_thread(self.gateway.cancel, run.run_id, self.worker_id)
        except Exception as exc:
            await asyncio.to_thread(
                self.gateway.fail,
                run.run_id,
                self.worker_id,
                error_code(exc),
                str(exc),
            )
        finally:
            renew_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renew_task
        return True

    async def run_forever(self) -> None:
        delay = 2.0
        while True:
            processed = await self.run_once()
            if processed:
                delay = 2.0
                continue
            await asyncio.to_thread(self.gateway.heartbeat, self.worker_id, "available", "0.1.0")
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 15.0)
