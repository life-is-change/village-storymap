from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_layering.render_experiment import render


def test_renderer_runs_lama_when_manifest_has_an_occlusion_mask(tmp_path):
    """Catches an accepted occlusion mask being ignored by the experiment renderer."""
    image = np.full((64, 64, 3), 180, np.uint8)
    mask = np.zeros((64, 64), np.uint8)
    mask[20:40, 20:40] = 255
    cv2.imwrite(str(tmp_path / "input.jpg"), image)
    cv2.imwrite(str(tmp_path / "mask.png"), mask)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "image": "input.jpg",
                "occlusion_mask": "mask.png",
                "output_size": [64, 64],
                "base_quad": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "layers": [],
            }
        ),
        encoding="utf-8",
    )
    worker = tmp_path / "worker.py"
    worker.write_text(
        "import shutil,sys\nshutil.copyfile(sys.argv[1], sys.argv[3])\n",
        encoding="utf-8",
    )

    paths = render(
        manifest_path,
        tmp_path / "output",
        lama_python=Path(sys.executable),
        lama_worker_script=worker,
    )

    assert tmp_path / "output" / "04-lama.png" in paths
    assert cv2.imread(str(tmp_path / "output" / "04-lama.png")).shape == (64, 64, 3)
    report = json.loads((tmp_path / "output" / "inpaint-result.json").read_text("utf-8"))
    assert report["provider"] == "lama"
