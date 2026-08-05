from __future__ import annotations

import cv2
import numpy as np


def valid_png_bytes() -> bytes:
    image = np.full((24, 36, 3), 180, dtype=np.uint8)
    encoded, buffer = cv2.imencode(".png", image)
    assert encoded
    return buffer.tobytes()


def test_prepare_direct_preserves_the_complete_uploaded_image(
    client, valid_job_form
):
    image = np.zeros((37, 59, 3), dtype=np.uint8)
    image[:, :20] = (0, 0, 255)
    encoded, buffer = cv2.imencode(".png", image)
    assert encoded
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("facade.png", buffer.tobytes(), "image/png"))],
    )
    job_id = created.json()["id"]
    assert client.post(f"/api/jobs/{job_id}/rectify").status_code == 200

    prepared = client.post(f"/api/jobs/{job_id}/prepare-direct")

    assert prepared.status_code == 200
    assert prepared.json()["status"] == "prepared"
    relative = prepared.json()["artifacts"]["rectified_facade"]
    stored_path = client.app.state.job_store.job_dir(job_id) / relative
    stored = cv2.imread(str(stored_path), cv2.IMREAD_COLOR)
    assert stored.shape == image.shape
    assert np.array_equal(stored, image)


def test_prepare_direct_rejects_multiple_photos(client, valid_job_form):
    encoded = valid_png_bytes()
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[
            ("photos", ("one.png", encoded, "image/png")),
            ("photos", ("two.png", encoded, "image/png")),
        ],
    )

    response = client.post(f"/api/jobs/{created.json()['id']}/rectify")

    assert response.status_code == 422
    assert response.json()["detail"] == "Rectification requires exactly one image"


def test_prepare_direct_rejects_an_undecodable_image(client, valid_job_form):
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("broken.png", b"not-png", "image/png"))],
    )

    response = client.post(f"/api/jobs/{created.json()['id']}/rectify")

    assert response.status_code == 422
    assert response.json()["detail"] == "Uploaded image cannot be decoded"


def test_prepare_direct_crops_roof_rows_and_blank_side_columns(
    client, valid_job_form
):
    image = np.full((50, 80, 3), 255, dtype=np.uint8)
    image[10:, 10:70] = 40
    encoded, buffer = cv2.imencode(".png", image)
    assert encoded
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("facade.png", buffer.tobytes(), "image/png"))],
    )
    job_id = created.json()["id"]
    assert client.post(f"/api/jobs/{job_id}/rectify").status_code == 200

    response = client.post(
        f"/api/jobs/{job_id}/prepare-direct?crop_top=0.2"
    )

    assert response.status_code == 200
    relative = response.json()["artifacts"]["rectified_facade"]
    stored = cv2.imread(
        str(client.app.state.job_store.job_dir(job_id) / relative),
        cv2.IMREAD_COLOR,
    )
    assert stored.shape == (40, 64, 3)


def test_prepare_direct_rejects_crop_top_below_or_above_safe_range(
    client, valid_job_form
):
    encoded = valid_png_bytes()
    created = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("facade.png", encoded, "image/png"))],
    )
    job_id = created.json()["id"]
    assert client.post(f"/api/jobs/{job_id}/rectify").status_code == 200

    below = client.post(f"/api/jobs/{job_id}/prepare-direct?crop_top=-0.01")
    above = client.post(f"/api/jobs/{job_id}/prepare-direct?crop_top=0.66")

    assert below.status_code == 422
    assert above.status_code == 422


def test_prepare_direct_derives_photo_height_from_front_length_and_texture_ratio(
    client, valid_job_form
):
    image = np.full((40, 80, 3), 180, dtype=np.uint8)
    encoded, buffer = cv2.imencode(".png", image)
    assert encoded
    form = {**valid_job_form, "building_width": "10", "roof_type": "hip"}
    created = client.post(
        "/api/jobs",
        data=form,
        files=[("photos", ("facade.png", buffer.tobytes(), "image/png"))],
    )
    job_id = created.json()["id"]
    assert client.post(f"/api/jobs/{job_id}/rectify").status_code == 200

    prepared = client.post(f"/api/jobs/{job_id}/prepare-direct")

    assert prepared.status_code == 200
    assert prepared.json()["building"]["wall_height"] == 5.0
    assert prepared.json()["building"]["roof_height"] == 0.9
