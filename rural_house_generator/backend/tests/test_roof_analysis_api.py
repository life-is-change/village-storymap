from __future__ import annotations

import cv2
import numpy as np


def encoded_gable_facade() -> tuple[bytes, float]:
    height, width = 420, 720
    roof_base = 190
    image = np.full((height, width, 3), 238, np.uint8)
    roof = np.asarray(
        [(120, roof_base), (360, 18), (600, roof_base)], dtype=np.int32
    )
    cv2.fillPoly(image, [roof], (48, 82, 188))
    cv2.rectangle(image, (120, roof_base), (600, 419), (185, 185, 185), -1)
    encoded, buffer = cv2.imencode(".png", image)
    assert encoded
    return buffer.tobytes(), roof_base / (height - 1)


def create_job(client, valid_job_form, *, rectify: bool = True) -> dict:
    photo, _ = encoded_gable_facade()
    response = client.post(
        "/api/jobs",
        data=valid_job_form,
        files=[("photos", ("gable.png", photo, "image/png"))],
    )
    assert response.status_code == 201
    job = response.json()
    if rectify:
        rectified = client.post(f"/api/jobs/{job['id']}/rectify")
        assert rectified.status_code == 200
        job = rectified.json()
    return job


def post_analysis(client, job_id: str, revision: int, **extra) -> object:
    _, crop_top = encoded_gable_facade()
    return client.post(
        f"/api/jobs/{job_id}/analyze-roof",
        data={
            "roof_top_norm": str(crop_top),
            "revision": str(revision),
            **extra,
        },
    )


def test_analyze_roof_endpoint_persists_resolved_automatic_values(
    client, valid_job_form
) -> None:
    job = create_job(client, valid_job_form)

    response = post_analysis(client, job["id"], 1)

    assert response.status_code == 200
    body = response.json()
    assert body["roof_analysis"]["revision"] == 1
    assert body["building"]["roof_type"] == "gable"
    assert body["building"]["roof_material"] == "terracotta_tile"
    assert body["building"]["roof_pitch"] == "high"
    assert body["building"]["roof_type"] == body["roof_analysis"]["type"]["value"]
    assert body["roof_analysis"]["type"]["source"] == "automatic"


def test_stale_analysis_revision_cannot_replace_manual_override(
    client, valid_job_form
) -> None:
    job = create_job(client, valid_job_form)

    accepted = post_analysis(
        client, job["id"], 4, roof_pitch_override="low"
    ).json()
    stale = post_analysis(client, job["id"], 3).json()

    assert stale["roof_analysis"] == accepted["roof_analysis"]
    assert stale["building"]["roof_pitch"] == "low"
    assert stale["roof_analysis"]["pitch"] == {
        "value": "low",
        "confidence": 1.0,
        "source": "manual",
    }


def test_newer_crop_analysis_preserves_existing_manual_fields(
    client, valid_job_form
) -> None:
    job = create_job(client, valid_job_form)
    post_analysis(client, job["id"], 1, roof_material_override="gray_tile")

    moved = post_analysis(client, job["id"], 2).json()

    assert moved["roof_analysis"]["material"]["source"] == "manual"
    assert moved["roof_analysis"]["material"]["value"] == "gray_tile"
    assert moved["roof_analysis"]["type"]["source"] == "automatic"
    assert moved["roof_analysis"]["revision"] == 2


def test_rectifying_again_clears_obsolete_roof_analysis(
    client, valid_job_form
) -> None:
    job = create_job(client, valid_job_form)
    analyzed = post_analysis(client, job["id"], 1)
    assert analyzed.json()["roof_analysis"] is not None

    rectified = client.post(f"/api/jobs/{job['id']}/rectify")

    assert rectified.status_code == 200
    assert rectified.json()["roof_analysis"] is None


def test_analyze_roof_requires_a_rectified_job(client, valid_job_form) -> None:
    job = create_job(client, valid_job_form, rectify=False)

    response = post_analysis(client, job["id"], 1)

    assert response.status_code == 409
    assert response.json()["detail"] == "Job must be rectified before roof analysis"


def test_analyze_roof_rejects_invalid_manual_value(client, valid_job_form) -> None:
    job = create_job(client, valid_job_form)

    response = post_analysis(
        client, job["id"], 1, roof_type_override="mansard"
    )

    assert response.status_code == 422
