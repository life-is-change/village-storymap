from pathlib import Path

from rural_house_generator.backend.app.config import GENERATOR_DIR, resolve_runtime_root


def test_runtime_root_uses_local_app_data_outside_the_watched_project(monkeypatch, tmp_path):
    monkeypatch.delenv("RURAL_FACADE_RUNTIME_ROOT", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    result = resolve_runtime_root()

    assert result == tmp_path / "VillageFacadeGenerator" / "runtime_storage"
    assert GENERATOR_DIR not in result.parents


def test_runtime_root_honors_an_explicit_override(monkeypatch, tmp_path):
    override = tmp_path / "custom-runtime"
    monkeypatch.setenv("RURAL_FACADE_RUNTIME_ROOT", str(override))

    assert resolve_runtime_root() == Path(override)
