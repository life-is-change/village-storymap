from pathlib import Path

from village_processing.health import run_health_checks


def test_health_never_echoes_secret(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "very-secret")
    monkeypatch.delenv("PLATFORM_DATA_ROOT", raising=False)

    assert run_health_checks() != 0
    assert "very-secret" not in capsys.readouterr().out


def test_missing_data_root_is_unhealthy(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("PLATFORM_DATA_ROOT", str(tmp_path / "missing"))

    assert run_health_checks() != 0


def test_worker_scripts_are_hidden_and_stop_is_path_guarded():
    root = Path(__file__).resolve().parents[2]
    start = (root / "server/scripts/start_platform_worker.ps1").read_text("utf-8")
    stop = (root / "server/scripts/stop_platform_worker.ps1").read_text("utf-8")

    assert "-WindowStyle Hidden" in start
    assert "127.0.0.1" in start
    assert "platform_building_worker" in stop
    assert "platform_geo_worker" in stop
    assert ".Path" in stop
