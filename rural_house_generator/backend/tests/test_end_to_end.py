from __future__ import annotations

from pathlib import Path

import cv2
from fastapi.testclient import TestClient

from rural_house_generator.backend.app.main import create_app


BLENDER_EXECUTABLE = Path(r"D:\Blender\blender.exe")


def test_generated_job_and_glb_survive_application_restart(
    runtime_root, valid_job_form, perspective_facade
):
    """Catches generated artifacts being reachable only from the creating process."""
    facade, _, _ = perspective_facade
    encoded, buffer = cv2.imencode(".png", facade)
    assert encoded
    hipped_job_form = {
        **valid_job_form,
        "roof_type": "hip",
        "roof_height": "1.08",
    }

    with TestClient(
        create_app(runtime_root=runtime_root, blender_executable=BLENDER_EXECUTABLE)
    ) as first_client:
        created = first_client.post(
            "/api/jobs",
            data=hipped_job_form,
            files=[("photos", ("facade.png", buffer.tobytes(), "image/png"))],
        )
        job_id = created.json()["id"]
        assert first_client.post(f"/api/jobs/{job_id}/rectify").status_code == 200
        prepared = first_client.post(f"/api/jobs/{job_id}/prepare-direct")
        assert prepared.status_code == 200
        generated = first_client.post(f"/api/jobs/{job_id}/generate")
        assert generated.status_code == 200, generated.text

    with TestClient(
        create_app(runtime_root=runtime_root, blender_executable=BLENDER_EXECUTABLE)
    ) as restarted_client:
        restored = restarted_client.get(f"/api/jobs/{job_id}")
        downloaded = restarted_client.get(
            f"/api/jobs/{job_id}/artifacts/building.glb"
        )
        manifest = restarted_client.get(
            f"/api/jobs/{job_id}/artifacts/model_manifest.json"
        )

    assert restored.status_code == 200
    assert restored.json()["status"] == "generated"
    assert downloaded.status_code == 200
    assert downloaded.content[:4] == b"glTF"
    assert manifest.status_code == 200
    names = set(manifest.json()["object_names"])
    assert {
        "Building body",
        "Photo facade",
        "Roof surface",
        "Roof soffit",
        "Roof ridge caps",
    } <= names
    assert len(
        [name for name in names if name.startswith("Roof hip ridge caps")]
    ) == 4
    assert not any(name.startswith("Roof downspout") for name in names)
