import multiprocessing
import os
from pathlib import Path
import time

import pytest

from village_processing.gpu_lock import gpu_lock


def _hold_lock(path, acquired, hold_seconds, waiter_ready=None):
    with gpu_lock(Path(path), timeout_seconds=2):
        acquired.set()
        if waiter_ready is not None:
            waiter_ready.wait(2)
        time.sleep(hold_seconds)


def _measure_acquire(path, output, waiter_ready=None):
    if waiter_ready is not None:
        waiter_ready.set()
    started = time.monotonic()
    with gpu_lock(Path(path), timeout_seconds=2):
        output.put(time.monotonic() - started)


def _exit_while_holding(path, acquired):
    with gpu_lock(Path(path), timeout_seconds=2):
        acquired.set()
        os._exit(0)


def test_gpu_lock_serializes_two_processes(tmp_path):
    context = multiprocessing.get_context("spawn")
    lock_path = tmp_path / "gpu-0.lock"
    acquired = context.Event()
    waiter_ready = context.Event()
    output = context.Queue()
    holder = context.Process(target=_hold_lock, args=(lock_path, acquired, 0.25, waiter_ready))
    waiter = context.Process(target=_measure_acquire, args=(lock_path, output, waiter_ready))

    holder.start()
    assert acquired.wait(2)
    waiter.start()
    holder.join(3)
    waiter.join(3)

    assert holder.exitcode == 0
    assert waiter.exitcode == 0
    assert output.get(timeout=1) >= 0.18


def test_gpu_lock_timeout_raises_stable_code(tmp_path):
    context = multiprocessing.get_context("spawn")
    lock_path = tmp_path / "gpu-0.lock"
    acquired = context.Event()
    holder = context.Process(target=_hold_lock, args=(lock_path, acquired, 0.5))
    holder.start()
    assert acquired.wait(2)

    with pytest.raises(TimeoutError, match="GPU_LOCK_TIMEOUT"):
        with gpu_lock(lock_path, timeout_seconds=0.05):
            pass
    holder.join(3)
    assert holder.exitcode == 0


def test_gpu_lock_is_released_when_holder_process_exits(tmp_path):
    context = multiprocessing.get_context("spawn")
    lock_path = tmp_path / "gpu-0.lock"
    acquired = context.Event()
    holder = context.Process(target=_exit_while_holding, args=(lock_path, acquired))
    holder.start()
    assert acquired.wait(2)
    holder.join(3)
    assert holder.exitcode == 0

    with gpu_lock(lock_path, timeout_seconds=0.5):
        assert lock_path.is_file()
