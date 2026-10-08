import asyncio
import contextlib
import logging
import re
from time import perf_counter
from typing import Callable


LOGGER = logging.getLogger(__name__)


class CancelRequested(Exception):
    pass


def error_code(error: Exception) -> str:
    value = str(error)
    if re.fullmatch(r"[A-Z][A-Z0-9_]{2,63}", value):
        return value
    return "PROCESSING_FAILED"


class Worker:
    def __init__(
        self,
        gateway,
        pipeline: Callable,
        worker_id: str,
        lease_renew_seconds: float = 30,
        source_status_publisher: Callable | None = None,
    ):
        self.gateway = gateway
        self.pipeline = pipeline
        self.worker_id = worker_id
        self.lease_renew_seconds = lease_renew_seconds
        self.source_status_publisher = source_status_publisher
        self._last_status_publish = 0.0

    async def _publish_status(self) -> None:
        if self.source_status_publisher is None:
            return
        if perf_counter() - self._last_status_publish < 30:
            return
        try:
            await asyncio.to_thread(self.source_status_publisher)
            self._last_status_publish = perf_counter()
        except Exception:
            LOGGER.exception("Local source status publication failed; continuing queue work")

    async def _renew_until_done(self, run_id: str) -> None:
        while True:
            await asyncio.sleep(self.lease_renew_seconds)
            await asyncio.to_thread(self.gateway.renew, run_id, self.worker_id)
            await asyncio.to_thread(self.gateway.heartbeat, self.worker_id, "busy", "0.1.0")
            await self._publish_status()

    async def run_once(self) -> bool:
        claim_started = perf_counter()
        run = await asyncio.to_thread(self.gateway.claim, self.worker_id)
        LOGGER.info("queue_claim seconds=%.3f found=%s", perf_counter() - claim_started, run is not None)
        if run is None:
            return False
        run_started = perf_counter()
        renew_task = asyncio.create_task(self._renew_until_done(run.run_id))
        try:
            if await asyncio.to_thread(self.gateway.is_cancel_requested, run.run_id):
                raise CancelRequested()
            await asyncio.to_thread(self.gateway.set_running, run.run_id, self.worker_id)
            pipeline_started = perf_counter()
            manifest = await asyncio.to_thread(self.pipeline, run)
            LOGGER.info("run=%s stage=pipeline seconds=%.3f", run.run_id, perf_counter() - pipeline_started)
            if await asyncio.to_thread(self.gateway.is_cancel_requested, run.run_id):
                raise CancelRequested()
            upload_started = perf_counter()
            for artifact in manifest.artifacts:
                await asyncio.to_thread(
                    self.gateway.upload_artifact,
                    run.owner_id,
                    run.run_id,
                    self.worker_id,
                    artifact,
                )
            LOGGER.info("run=%s stage=upload seconds=%.3f", run.run_id, perf_counter() - upload_started)
            await asyncio.to_thread(
                self.gateway.complete, run.run_id, self.worker_id, manifest.warnings
            )
        except CancelRequested:
            await asyncio.to_thread(self.gateway.cancel, run.run_id, self.worker_id)
        except Exception as exc:
            LOGGER.exception("run=%s processing failed", run.run_id)
            code = error_code(exc)
            await asyncio.to_thread(
                self.gateway.fail,
                run.run_id,
                self.worker_id,
                code,
                code if code != "PROCESSING_FAILED" else "处理失败，请联系管理员并提供任务编号。",
            )
        finally:
            LOGGER.info("run=%s stage=total seconds=%.3f", run.run_id, perf_counter() - run_started)
            renew_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renew_task
        return True

    async def run_forever(self) -> None:
        delay = 2.0
        while True:
            processed = await self.run_cycle()
            if processed:
                delay = 2.0
                continue
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 15.0)

    async def run_cycle(self) -> bool:
        try:
            await asyncio.to_thread(self.gateway.heartbeat, self.worker_id, "available", "0.1.0")
            await self._publish_status()
            processed = await self.run_once()
            return processed
        except Exception:
            LOGGER.exception("Worker queue cycle failed; retrying without exiting")
            return False
