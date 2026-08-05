from __future__ import annotations

import cv2
from fastapi.testclient import TestClient

from rural_house_generator.backend.app.main import create_app


def _create_photo_job(client, valid_job_form, photo) -> str:
    encoded, buffer = cv2.imencode(".jpg", photo)
    assert encoded
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("ordinary-photo.jpg", buffer.tobytes(), "image/jpeg"))],
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_prepare_job_rectifies_normalized_corners_and_persists_artifacts(
    client, runtime_root, valid_job_form, perspective_facade
):
    """Catches preparing only in memory or treating normalized points as pixels."""
    _, photo, pixel_corners = perspective_facade
    job_id = _create_photo_job(client, valid_job_form, photo)
    height, width = photo.shape[:2]
    normalized = [
        {"x": float(x / (width - 1)), "y": float(y / (height - 1))}
        for x, y in pixel_corners
    ]

    response = client.post(
        f"/api/jobs/{job_id}/prepare",
        json={"photo_index": 0, "corners": normalized},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "prepared"
    assert payload["artifacts"]["rectified_facade"] == (
        "artifacts/rectified_facade.png"
    )
    assert payload["artifacts"]["rectified_preview"] == (
        "artifacts/rectified_preview.jpg"
    )
    assert (runtime_root / job_id / "artifacts" / "rectified_facade.png").is_file()
    assert (runtime_root / job_id / "artifacts" / "rectified_preview.jpg").is_file()

    reloaded = client.get(f"/api/jobs/{job_id}").json()
    assert reloaded["status"] == "prepared"
    assert reloaded["artifacts"] == payload["artifacts"]


def test_prepare_job_rejects_degenerate_normalized_corners(
    client, valid_job_form, perspective_facade
):
    """Catches invalid selections being persisted as successful preparations."""
    _, photo, _ = perspective_facade
    job_id = _create_photo_job(client, valid_job_form, photo)

    response = client.post(
        f"/api/jobs/{job_id}/prepare",
        json={
            "photo_index": 0,
            "corners": [
                {"x": 0.1, "y": 0.1},
                {"x": 0.2, "y": 0.2},
                {"x": 0.3, "y": 0.3},
                {"x": 0.4, "y": 0.4},
            ],
        },
    )

    assert response.status_code == 422
    assert "valid quadrilateral" in response.json()["detail"]


def test_prepare_job_supports_non_ascii_runtime_path(
    tmp_path, valid_job_form, perspective_facade
):
    """Catches OpenCV filename APIs failing under the Chinese workspace path."""
    _, photo, pixel_corners = perspective_facade
    runtime_root = tmp_path / "中文运行目录"
    height, width = photo.shape[:2]
    normalized = [
        {"x": float(x / (width - 1)), "y": float(y / (height - 1))}
        for x, y in pixel_corners
    ]

    with TestClient(create_app(runtime_root=runtime_root)) as unicode_client:
        job_id = _create_photo_job(unicode_client, valid_job_form, photo)
        response = unicode_client.post(
            f"/api/jobs/{job_id}/prepare",
            json={"photo_index": 0, "corners": normalized},
        )

    assert response.status_code == 200, response.text
    assert (runtime_root / job_id / "artifacts" / "rectified_facade.png").is_file()
