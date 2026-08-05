from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_layering.inpaint_provider import run_lama


def _write_inputs(tmp_path: Path) -> tuple[Path, Path]:
    image = np.full((32, 48, 3), (40, 120, 210), dtype=np.uint8)
    mask = np.zeros((32, 48), dtype=np.uint8)
    mask[8:24, 16:32] = 255
    image_path = tmp_path / "input.png"
    mask_path = tmp_path / "mask.png"
    image_ok, encoded_image = cv2.imencode(".png", image)
    mask_ok, encoded_mask = cv2.imencode(".png", mask)
    assert image_ok and mask_ok
    encoded_image.tofile(str(image_path))
    encoded_mask.tofile(str(mask_path))
    return image_path, mask_path


def test_run_lama_accepts_a_valid_worker_output(tmp_path):
    """Catches a successful worker being mislabeled as fallback processing."""
    image_path, mask_path = _write_inputs(tmp_path)
    worker = tmp_path / "worker.py"
    worker.write_text(
        """
import shutil
import sys
shutil.copyfile(sys.argv[1], sys.argv[3])
""".strip(),
        encoding="utf-8",
    )
    output_path = tmp_path / "output.png"

    result = run_lama(
        image_path,
        mask_path,
        output_path,
        Path(sys.executable),
        worker_script=worker,
    )

    assert result.provider == "lama"
    assert result.output_path == output_path
    assert cv2.imread(str(output_path)).shape == (32, 48, 3)
    assert result.elapsed_seconds >= 0


def test_run_lama_preserves_input_when_worker_times_out(tmp_path):
    """Catches a timeout leaving a missing or partially written facade texture."""
    image_path, mask_path = _write_inputs(tmp_path)
    worker = tmp_path / "slow_worker.py"
    worker.write_text(
        "import time\ntime.sleep(2)",
        encoding="utf-8",
    )
    output_path = tmp_path / "output.png"

    result = run_lama(
        image_path,
        mask_path,
        output_path,
        Path(sys.executable),
        timeout_seconds=0.1,
        worker_script=worker,
    )

    assert result.provider == "none"
    np.testing.assert_array_equal(cv2.imread(str(output_path)), cv2.imread(str(image_path)))
    assert any("timed out" in note.lower() for note in result.notes)


def test_run_lama_preserves_input_when_python_is_missing(tmp_path):
    """Catches a missing isolated environment destroying the usable layered result."""
    image_path, mask_path = _write_inputs(tmp_path)
    output_path = tmp_path / "output.png"

    result = run_lama(
        image_path,
        mask_path,
        output_path,
        tmp_path / "missing-python.exe",
    )

    assert result.provider == "none"
    np.testing.assert_array_equal(cv2.imread(str(output_path)), cv2.imread(str(image_path)))
    assert any("not found" in note.lower() for note in result.notes)


def test_run_lama_validates_worker_output_under_a_unicode_path(tmp_path):
    """Catches cv2.imread rejecting valid LaMa output beneath a Chinese Windows path."""
    unicode_root = tmp_path / "立面实验"
    unicode_root.mkdir()
    image_path, mask_path = _write_inputs(unicode_root)
    worker = unicode_root / "worker.py"
    worker.write_text(
        "import shutil,sys\nshutil.copyfile(sys.argv[1], sys.argv[3])\n",
        encoding="utf-8",
    )

    result = run_lama(
        image_path,
        mask_path,
        unicode_root / "补洞结果.png",
        Path(sys.executable),
        worker_script=worker,
    )

    assert result.provider == "lama"
