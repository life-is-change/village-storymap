from __future__ import annotations

import json
from pathlib import Path

import cv2
from fastapi.testclient import TestClient

from rural_house_generator.backend.app.main import create_app


BLENDER_EXECUTABLE = Path(r"D:\Blender\blender.exe")


def test_generate_job_runs_real_blender_and_serves_binary_glb(
    runtime_root, valid_job_form, perspective_facade
):
    """Catches a reported success without a real downloadable Blender GLB."""
    assert BLENDER_EXECUTABLE.is_file(), "Local Blender is required for this smoke test"
    facade, _, _ = perspective_facade
    encoded, buffer = cv2.imencode(".png", facade)
    assert encoded
    hipped_job_form = {
        **valid_job_form,
        "roof_type": "hip",
        "roof_height": "1.08",
    }

    with TestClient(
        create_app(
            runtime_root=runtime_root, blender_executable=BLENDER_EXECUTABLE
        )
    ) as client:
        created = client.post(
            "/api/jobs",
            data=hipped_job_form,
            files=[("photos", ("facade.png", buffer.tobytes(), "image/png"))],
        )
        assert created.status_code == 201
        job_id = created.json()["id"]
        assert client.post(f"/api/jobs/{job_id}/rectify").status_code == 200
        prepared = client.post(f"/api/jobs/{job_id}/prepare-direct")
        assert prepared.status_code == 200

        generated = client.post(f"/api/jobs/{job_id}/generate")

        assert generated.status_code == 200, generated.text
        payload = generated.json()
        assert payload["status"] == "generated"
        assert payload["artifacts"]["building_glb"] == "artifacts/building.glb"
        assert payload["artifacts"]["model_manifest"] == "artifacts/model_manifest.json"

        manifest_response = client.get(
            f"/api/jobs/{job_id}/artifacts/model_manifest.json"
        )
        assert manifest_response.status_code == 200
        manifest = json.loads(manifest_response.content)
        assert set(manifest["object_names"]) == {
            "Building body",
            "Photo facade",
            "Hipped roof",
        }
        prepared_building = prepared.json()["building"]
        assert manifest["roof"] == {
            "type": "hip",
            "height": prepared_building["roof_height"],
        }
        assert manifest["dimensions"]["height"] == prepared_building["wall_height"]

        downloaded = client.get(
            f"/api/jobs/{job_id}/artifacts/building.glb"
        )
        assert downloaded.status_code == 200
        assert downloaded.headers["content-type"] == "model/gltf-binary"
        assert downloaded.content[:4] == b"glTF"
        assert len(downloaded.content) > 1_000
