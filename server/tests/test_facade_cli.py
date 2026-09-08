from pathlib import Path
from types import SimpleNamespace

import pytest

from village_processing import __main__ as cli
from village_processing.health import run_facade_health_checks


def test_parser_registers_facade_worker_command():
    args = cli.build_parser().parse_args(["facade-worker"])

    assert args.command == "facade-worker"


def test_facade_worker_requires_service_role_configuration(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    with pytest.raises(SystemExit, match="SUPABASE_SERVICE_ROLE_KEY is required"):
        cli.main(["facade-worker"])


def test_facade_health_checks_blender_internal_workers_and_storage(
    monkeypatch, tmp_path: Path, capsys
):
    work_root = tmp_path / "work"
    model_root = tmp_path / "models"
    sam_repo = model_root / "building-seg" / "repos" / "sam2"
    checkpoint = model_root / "building-seg" / "checkpoints" / "sam2.1_hiera_large.pt"
    work_root.mkdir()
    sam_repo.mkdir(parents=True)
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"checkpoint")
    blender = tmp_path / "blender"
    blender.write_bytes(b"executable")

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "very-secret")
    monkeypatch.setenv("FACADE_WORK_ROOT", str(work_root))
    monkeypatch.setenv("FACADE_MODEL_ROOT", str(model_root))
    monkeypatch.setenv("SAM2_CHECKPOINT", str(checkpoint))
    monkeypatch.setenv("BLENDER_EXECUTABLE", str(blender))
    monkeypatch.setenv("RURAL_FACADE_ML_URL", "http://facade-ml:8012")
    monkeypatch.setenv("RURAL_LAMA_URL", "http://facade-lama:8013")

    class FakeStorage:
        def get_bucket(self, name):
            assert name in {"facade-generation", "house-photos"}
            return {"name": name}

    client = SimpleNamespace(storage=FakeStorage())

    def fake_run(command, **_kwargs):
        assert command == [str(blender), "--version"]
        return SimpleNamespace(returncode=0, stdout="Blender 3.0.1\n", stderr="")

    def fake_get(url, **_kwargs):
        assert url in {
            "http://facade-ml:8012/health",
            "http://facade-lama:8013/health",
        }
        return SimpleNamespace(status_code=200)

    assert run_facade_health_checks(
        client=client, subprocess_run=fake_run, http_get=fake_get
    ) == 0
    output = capsys.readouterr().out
    assert "BLENDER_3_0_1=OK" in output
    assert "FACADE_ML=OK" in output
    assert "FACADE_LAMA=OK" in output
    assert "FACADE_STORAGE=OK" in output
    assert "very-secret" not in output


def test_facade_worker_stops_before_claim_when_health_fails(monkeypatch):
    claimed = False

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(cli, "run_facade_worker", lambda: pytest.fail("worker started"))
    monkeypatch.setattr(cli, "run_facade_health_checks", lambda **_kwargs: 1)

    with pytest.raises(SystemExit, match="Facade worker health checks failed"):
        cli.main(["facade-worker"])

    assert claimed is False
