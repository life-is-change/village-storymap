from __future__ import annotations

from pathlib import Path

import pytest

from rural_house_generator.backend.app.blender_service import (
    BlenderService,
    BlenderUnavailableError,
    MissingTextureError,
    build_blender_command,
)


def test_build_blender_command_keeps_paths_as_separate_arguments(tmp_path):
    """Catches shell interpolation breaking paths with spaces or enabling injection."""
    executable = Path(r"D:\Apps With Spaces\blender.exe")
    script = tmp_path / "generate building.py"
    config = tmp_path / "job config.json"

    command = build_blender_command(executable, script, config)

    assert command == [
        str(executable),
        "--background",
        "--python",
        str(script),
        "--",
        "--config",
        str(config),
    ]


def test_blender_service_rejects_missing_executable_before_launch(tmp_path):
    """Catches an opaque subprocess failure when Blender is not configured."""
    service = BlenderService(executable=tmp_path / "missing-blender.exe")
    texture = tmp_path / "facade.png"
    texture.write_bytes(b"image")

    with pytest.raises(BlenderUnavailableError, match="Blender executable"):
        service.generate(
            job_dir=tmp_path,
            building={
                "width": 8.0,
                "depth": 6.0,
                "wall_height": 6.0,
                "roof_height": 2.0,
                "roof_type": "gable",
            },
            texture_path=texture,
        )


def test_blender_service_rejects_missing_prepared_texture(tmp_path):
    """Catches launching Blender for an unprepared job."""
    executable = tmp_path / "blender.exe"
    executable.write_bytes(b"placeholder")
    service = BlenderService(executable=executable)

    with pytest.raises(MissingTextureError, match="Prepared facade texture"):
        service.generate(
            job_dir=tmp_path,
            building={
                "width": 8.0,
                "depth": 6.0,
                "wall_height": 6.0,
                "roof_height": 2.0,
                "roof_type": "gable",
            },
            texture_path=tmp_path / "missing.png",
        )
