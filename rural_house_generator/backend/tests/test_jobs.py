from __future__ import annotations

import json

from rural_house_generator.backend.app.job_store import DiskJobStore


def test_create_job_persists_uploaded_photos_and_metadata(
    client, runtime_root, valid_job_form
):
    """Catches accepting an upload without persisting its files and job state."""
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[
            ("photos", ("front.JPG", b"jpeg-one", "image/jpeg")),
            ("photos", ("side.png", b"png-two", "image/png")),
        ],
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "uploaded"
    assert len(payload["photos"]) == 2

    job_dir = runtime_root / payload["id"]
    assert (job_dir / "job.json").is_file()
    stored_names = sorted(path.name for path in (job_dir / "inputs").iterdir())
    assert stored_names == ["001-front.jpg", "002-side.png"]

    on_disk = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    assert on_disk["building"]["width"] == 8.0
    assert on_disk["building"]["roof_type"] == "gable"
    assert on_disk["building"]["roof_material"] == "asphalt_shingle"
    assert on_disk["building"]["roof_pitch"] == "low"


def test_create_job_defaults_roof_appearance_for_old_callers(client, valid_job_form):
    legacy_form = {
        key: value
        for key, value in valid_job_form.items()
        if key not in {"roof_material", "roof_pitch"}
    }
    response = client.post(
        "/api/jobs",
        data=legacy_form,
        files=[("photos", ("front.jpg", b"photo", "image/jpeg"))],
    )

    assert response.status_code == 201
    assert response.json()["building"]["roof_material"] == "gray_tile"
    assert response.json()["building"]["roof_pitch"] == "standard"


def test_disk_store_reads_job_after_new_instance(client, runtime_root, valid_job_form):
    """Catches replacing disk persistence with process-only in-memory state."""
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("front.jpg", b"photo", "image/jpeg"))],
    )
    job_id = response.json()["id"]

    reloaded = DiskJobStore(runtime_root).get(job_id)

    assert reloaded["id"] == job_id
    assert reloaded["status"] == "uploaded"
    assert reloaded["photos"][0]["filename"] == "001-front.jpg"


def test_get_missing_job_returns_404(client):
    """Catches missing jobs being reported as successful empty records."""
    response = client.get("/api/jobs/not-a-real-job")

    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found"


def test_create_job_rejects_unsupported_file_type(client, valid_job_form):
    """Catches arbitrary uploaded file types reaching local processing."""
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("notes.txt", b"not an image", "text/plain"))],
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Only JPEG and PNG photos are supported"


def test_create_job_rejects_photo_larger_than_ten_megabytes(
    client, valid_job_form
):
    """Catches unbounded uploads exhausting local disk or memory."""
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[
            (
                "photos",
                ("too-large.jpg", b"x" * (10 * 1024 * 1024 + 1), "image/jpeg"),
            )
        ],
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Each photo must be 10 MB or smaller"
