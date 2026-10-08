from __future__ import annotations

import json
from pathlib import Path

import pytest

from rural_house_generator.backend.app.facade.model_client import LocalModelClient, ModelWorkerError


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


def test_model_client_requires_all_generated_artifacts(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        "rural_house_generator.backend.app.facade.model_client.urlopen",
        lambda *args, **kwargs: _Response({"ok": True, "artifacts": {}}),
    )

    with pytest.raises(ModelWorkerError, match="缺少输出"):
        LocalModelClient().process(tmp_path / "photo.jpg", tmp_path)


def test_model_client_accepts_complete_worker_result(monkeypatch, tmp_path: Path):
    paths = {}
    for name in ("cleaned_source", "building_mask", "occlusion_mask"):
        path = tmp_path / f"{name}.png"
        path.write_bytes(b"x")
        paths[name] = str(path)
    monkeypatch.setattr(
        "rural_house_generator.backend.app.facade.model_client.urlopen",
        lambda *args, **kwargs: _Response({"ok": True, "artifacts": paths, "diagnostics": {"sam_model": "large"}}),
    )

    result = LocalModelClient().process(tmp_path / "photo.jpg", tmp_path)

    assert result.building_mask.name == "building_mask.png"
    assert result.diagnostics["sam_model"] == "large"
