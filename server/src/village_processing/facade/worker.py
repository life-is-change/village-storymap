from __future__ import annotations

import asyncio
import contextlib
import logging

from village_processing.worker import error_code

from .pipeline import FacadeCancelRequested


LOGGER = logging.getLogger(__name__)


class FacadeWorker:
    def __init__(
        self,
        gateway,
        pipeline,
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
                raise FacadeCancelRequested()
            await asyncio.to_thread(self.pipeline.execute, run)
        except FacadeCancelRequested:
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

    async def run_cycle(self) -> bool:
        try:
            processed = await self.run_once()
            if not processed:
                await asyncio.to_thread(
                    self.gateway.heartbeat,
                    self.worker_id,
                    "available",
                    "0.1.0",
                )
            return processed
        except Exception:
            LOGGER.exception("Facade worker queue cycle failed; retrying")
            return False

    async def run_forever(self) -> None:
        delay = 2.0
        while True:
            processed = await self.run_cycle()
            if processed:
                delay = 2.0
                continue
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 15.0)

