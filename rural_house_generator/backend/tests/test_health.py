from pathlib import Path


def test_health_reports_service_ready(client):
    """Catches a missing or incorrectly mounted health route."""
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "rural-facade-generator"
    assert Path(payload["runtime_root"]).is_absolute()


def test_local_static_server_can_preflight_job_upload(client):
    """Catches the browser blocking the local UI before it can upload a photo."""
    response = client.options(
        "/api/jobs",
        headers={
            "Origin": "http://127.0.0.1:8000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "http://127.0.0.1:8000"
    )
