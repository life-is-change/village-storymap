from __future__ import annotations

import json
from pathlib import Path

import pytest

from experiments.facade_layering.manifest import ManifestError, load_manifest


def _valid_payload() -> dict:
    return {
        "image": "input.jpg",
        "output_size": [800, 1000],
        "base_quad": [[0.1, 0.1], [0.9, 0.12], [0.92, 0.9], [0.08, 0.88]],
        "layers": [
            {
                "name": "upper-balcony",
                "source_quad": [
                    [0.15, 0.2],
                    [0.85, 0.22],
                    [0.86, 0.38],
                    [0.14, 0.36],
                ],
                "destination_box": [0.1, 0.2, 0.9, 0.38],
                "feather_px": 8,
            }
        ],
    }


def _write_manifest(tmp_path: Path, payload: dict) -> Path:
    (tmp_path / "input.jpg").write_bytes(b"fixture")
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_load_manifest_converts_normalized_quads_to_source_pixels(tmp_path):
    """Catches treating normalized annotations as already being pixel coordinates."""
    manifest = load_manifest(_write_manifest(tmp_path, _valid_payload()), (1200, 1600))

    assert manifest.output_size == (800, 1000)
    assert manifest.base_quad.tolist()[0] == pytest.approx([159.9, 119.9])
    assert manifest.layers[0].source_quad.tolist()[2] == pytest.approx([1375.14, 455.62])
    assert manifest.layers[0].destination_box == (0.1, 0.2, 0.9, 0.38)


def test_load_manifest_rejects_non_quadrilateral_base(tmp_path):
    """Catches malformed annotations reaching OpenCV as an opaque assertion error."""
    payload = _valid_payload()
    payload["base_quad"] = payload["base_quad"][:3]

    with pytest.raises(ManifestError, match="base_quad.*four"):
        load_manifest(_write_manifest(tmp_path, payload), (1200, 1600))


def test_load_manifest_rejects_invalid_layer_destination(tmp_path):
    """Catches a reversed destination rectangle producing an empty layer."""
    payload = _valid_payload()
    payload["layers"][0]["destination_box"] = [0.8, 0.2, 0.2, 0.4]

    with pytest.raises(ManifestError, match="destination_box"):
        load_manifest(_write_manifest(tmp_path, payload), (1200, 1600))


def test_load_manifest_rejects_relative_path_escape(tmp_path):
    """Catches an experiment manifest reading arbitrary files outside its directory."""
    payload = _valid_payload()
    payload["image"] = "../outside.jpg"

    with pytest.raises(ManifestError, match="inside the manifest directory"):
        load_manifest(_write_manifest(tmp_path, payload), (1200, 1600))
