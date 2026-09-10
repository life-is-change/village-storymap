from __future__ import annotations

from contextlib import contextmanager
import errno
import os
from pathlib import Path
import tempfile
import time


def default_gpu_lock_path() -> Path:
    if os.name == "nt":
        return Path(tempfile.gettempdir()) / "village-platform" / "gpu-0.lock"
    return Path("/work/.locks/gpu-0.lock")


@contextmanager
def gpu_lock(path: Path, timeout_seconds: float = 900.0):
    """Acquire an exclusive process lock or raise GPU_LOCK_TIMEOUT."""
    lock_path = Path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + max(0.0, float(timeout_seconds))
    stream = lock_path.open("a+b")
    if stream.tell() == 0:
        stream.write(b"\0")
        stream.flush()

    acquired = False
    try:
        while not acquired:
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK, 13, 36):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError("GPU_LOCK_TIMEOUT") from exc
                time.sleep(0.05)
        yield
    finally:
        if acquired:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        stream.close()

