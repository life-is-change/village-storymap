from __future__ import annotations

from pathlib import Path

import pytest

from experiments.facade_model_ab.run_real_matrix import discover_sample_manifests


def test_discover_sample_manifests_is_ordered_and_requires_every_sample(tmp_path: Path) -> None:
    for name in ("sample_05", "sample_04"):
        folder = tmp_path / name
        folder.mkdir()
        (folder / "constrained-manifest.json").write_text("{}", encoding="utf-8")

    manifests = discover_sample_manifests(tmp_path, ("sample_04", "sample_05"))

    assert list(manifests) == ["sample_04", "sample_05"]
    assert manifests["sample_04"] == tmp_path / "sample_04" / "constrained-manifest.json"
    with pytest.raises(FileNotFoundError, match="sample_06"):
        discover_sample_manifests(tmp_path, ("sample_04", "sample_06"))
