from __future__ import annotations

import cv2
import numpy as np
from fastapi.testclient import TestClient

from rural_house_generator.backend.app.facade.auto_rectify import RectificationResult
from rural_house_generator.backend.app.main import create_app


class StubRectifier:
    def rectify(self, image: np.ndarray) -> RectificationResult:
        return RectificationResult(
            image=np.ascontiguousarray(image[2:-2, 3:-3]),
            diagnostics={"method": "stub-global-h0", "resample_passes": 1},
        )


def _png(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_rectify_persists_source_preview_and_diagnostics(runtime_root, valid_job_form):
    image = np.full((40, 60, 3), 170, np.uint8)
    with TestClient(create_app(runtime_root=runtime_root, facade_rectifier=StubRectifier())) as client:
        created = client.post(
            "/api/jobs",
            data=valid_job_form,
            files=[("photos", ("photo.png", _png(image), "image/png"))],
        )
        response = client.post(f"/api/jobs/{created.json()['id']}/rectify")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "rectified"
    assert set(payload["artifacts"]) >= {
        "rectified_source",
        "rectified_preview",
        "rectification_diagnostics",
    }
    job_dir = runtime_root / created.json()["id"]
    assert cv2.imread(str(job_dir / payload["artifacts"]["rectified_source"])).shape == (36, 54, 3)
    assert (job_dir / payload["artifacts"]["rectification_diagnostics"]).read_text(encoding="utf-8").find("stub-global-h0") >= 0


def test_prepare_direct_rejects_crop_before_rectification(client, valid_job_form):
    image = np.full((24, 36, 3), 180, np.uint8)
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("photo.png", _png(image), "image/png"))],
    )

    response = client.post(f"/api/jobs/{created.json()['id']}/prepare-direct?crop_top=0.2")

    assert response.status_code == 409
    assert "rectified" in response.json()["detail"].lower()


def test_user_can_explicitly_continue_with_the_original_photo(
    client, runtime_root, valid_job_form
):
    image = np.full((80, 120, 3), 180, np.uint8)
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("photo.png", _png(image), "image/png"))],
    )

    response = client.post(f"/api/jobs/{created.json()['id']}/rectify?use_original=true")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "rectified"
    diagnostics = runtime_root / created.json()["id"] / payload["artifacts"]["rectification_diagnostics"]
    assert "user_original_fallback" in diagnostics.read_text(encoding="utf-8")
