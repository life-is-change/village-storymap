from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]


def test_environment_files_forbid_source_builds_and_expected_prefixes():
    script = (ROOT / "server/scripts/create_platform_envs.ps1").read_text("utf-8")

    assert "platform_building_worker" in script
    assert "platform_geo_worker" in script
    assert "$env:CONDA_PKGS_DIRS" in script
    assert ".platform-pkgs" in script
    assert "--only-binary=:all:" in script
    assert "numpy==1.26.4" in script
    assert "scipy==1.11.4" in script
    assert "pandas==2.1.4" in script
    assert "opencv-python==4.8.1.78" in script
    assert "setuptools==81.0.0" in script
    assert "pytest>=8,<9" in script
    assert "Build Tools" not in script


def test_large_runtime_assets_are_ignored():
    ignore = (ROOT / ".gitignore").read_text("utf-8")

    for pattern in ("*.pth", "*.pbf", "server/runtime/", "server/.env"):
        assert pattern in ignore


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell parser contract is Windows-only")
def test_environment_powershell_scripts_parse_cleanly():
    scripts = ROOT / "server/scripts"

    for script in scripts.glob("*.ps1"):
        command = (
            "$errors = $null; "
            f"[System.Management.Automation.Language.Parser]::ParseFile('{script}', "
            "[ref]$null, [ref]$errors) | Out-Null; "
            "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert result.returncode == 0, result.stderr


def test_platform_startup_waits_for_building_health_instead_of_fixed_delay():
    script = (ROOT / "server/scripts/start_platform_worker.ps1").read_text("utf-8")

    assert "Wait-ForBuildingService" in script
    assert "$BuildingStartupTimeoutSeconds" in script
    assert ".HasExited" in script
    assert "Start-Sleep -Milliseconds 500" in script
    assert "Start-Sleep -Seconds 4" not in script
