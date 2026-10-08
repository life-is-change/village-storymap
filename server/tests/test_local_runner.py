from pathlib import Path
import subprocess

import pytest

from village_processing.local_runner import LocalToolConfig, safe_job_slug, staged_runtime_check


def test_local_tool_config_requires_existing_sources(tmp_path: Path):
    present = tmp_path / "present.bin"
    present.write_bytes(b"x")
    with pytest.raises(ValueError, match="LOCAL_SOURCE_MISSING: imagery"):
        LocalToolConfig.from_dict({
            "tool_root": str(tmp_path),
            "imagery": str(tmp_path / "missing.tif"),
            "boundary": str(present),
            "osm": str(present),
            "dem": str(present),
            "model_config": str(present),
            "model_checkpoint": str(present),
            "village_name": "测试村",
            "village_slug": "test-village",
        })


def test_job_slug_cannot_escape_output_root():
    assert safe_job_slug("Demo Village") == "demo-village"
    with pytest.raises(ValueError, match="LOCAL_VILLAGE_SLUG_INVALID"):
        safe_job_slug("../../escape")


def test_runtime_check_times_out_instead_of_hanging():
    result = staged_runtime_check(
        ["python", "-c", "import time; time.sleep(10)"],
        timeout_seconds=0.05,
    )
    assert result == {"ok": False, "code": "RUNTIME_CHECK_TIMEOUT", "detail": ""}


def test_runtime_check_reports_failed_import():
    result = staged_runtime_check(
        ["python", "-c", "raise RuntimeError('broken')"],
        timeout_seconds=2,
    )
    assert result["ok"] is False
    assert result["code"] == "RUNTIME_CHECK_FAILED"
    assert "broken" in result["detail"]
