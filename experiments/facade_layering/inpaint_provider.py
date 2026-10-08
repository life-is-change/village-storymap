from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class InpaintResult:
    provider: str
    output_path: Path
    elapsed_seconds: float
    notes: tuple[str, ...]


def _read_image(path: Path):
    try:
        encoded = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        return None
    if encoded.size == 0:
        return None
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def _preserve_input(
    image_path: Path,
    output_path: Path,
    started_at: float,
    note: str,
) -> InpaintResult:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(image_path, output_path)
    return InpaintResult(
        provider="none",
        output_path=output_path,
        elapsed_seconds=time.perf_counter() - started_at,
        notes=(note,),
    )


def run_lama(
    image_path: Path,
    mask_path: Path,
    output_path: Path,
    python_executable: Path,
    timeout_seconds: float = 300,
    worker_script: Path | None = None,
) -> InpaintResult:
    started_at = time.perf_counter()
    image_path = image_path.resolve()
    mask_path = mask_path.resolve()
    output_path = output_path.resolve()
    python_executable = python_executable.resolve()
    if not python_executable.is_file():
        return _preserve_input(
            image_path,
            output_path,
            started_at,
            f"LaMa Python executable not found: {python_executable}",
        )
    if not image_path.is_file() or not mask_path.is_file():
        missing = image_path if not image_path.is_file() else mask_path
        return _preserve_input(
            image_path,
            output_path,
            started_at,
            f"LaMa input not found: {missing}",
        )

    script = (worker_script or Path(__file__).with_name("lama_worker.py")).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(python_executable),
        str(script),
        str(image_path),
        str(mask_path),
        str(output_path),
    ]
    try:
        completed = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return _preserve_input(
            image_path,
            output_path,
            started_at,
            f"LaMa worker timed out after {timeout_seconds:g} seconds",
        )
    except OSError as exc:
        return _preserve_input(
            image_path,
            output_path,
            started_at,
            f"LaMa worker could not start: {exc}",
        )

    source = _read_image(image_path)
    result = _read_image(output_path)
    if completed.returncode != 0 or source is None or result is None or result.shape != source.shape:
        detail = (completed.stderr or completed.stdout or "no worker output").strip()[-800:]
        return _preserve_input(
            image_path,
            output_path,
            started_at,
            f"LaMa worker failed with code {completed.returncode}: {detail}",
        )

    notes = tuple(
        line.strip() for line in completed.stdout.splitlines() if line.strip()
    )
    return InpaintResult(
        provider="lama",
        output_path=output_path,
        elapsed_seconds=time.perf_counter() - started_at,
        notes=notes,
    )
