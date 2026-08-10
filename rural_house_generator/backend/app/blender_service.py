from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class BlenderUnavailableError(RuntimeError):
    pass


class MissingTextureError(RuntimeError):
    pass


class BlenderGenerationError(RuntimeError):
    pass


def build_blender_command(
    executable: Path, script_path: Path, config_path: Path
) -> list[str]:
    return [
        str(executable),
        "--background",
        "--python",
        str(script_path),
        "--",
        "--config",
        str(config_path),
    ]


class BlenderService:
    def __init__(
        self,
        executable: Path,
        script_path: Path | None = None,
        timeout_seconds: int = 180,
    ):
        self.executable = Path(executable)
        self.script_path = script_path or (
            Path(__file__).resolve().parent / "blender" / "generate_building.py"
        )
        self.timeout_seconds = timeout_seconds

    def generate(
        self,
        job_dir: Path,
        building: dict[str, Any],
        texture_path: Path,
        roof_analysis: dict[str, Any] | None = None,
    ) -> Path:
        if not self.executable.is_file():
            raise BlenderUnavailableError(
                f"Blender executable not found: {self.executable}"
            )
        if not texture_path.is_file():
            raise MissingTextureError(
                f"Prepared facade texture not found: {texture_path}"
            )
        if not self.script_path.is_file():
            raise BlenderGenerationError(
                f"Blender generation script not found: {self.script_path}"
            )

        artifact_dir = Path(job_dir) / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        output_path = (artifact_dir / "building.glb").resolve()
        config_path = (artifact_dir / "blender_job.json").resolve()
        config_path.write_text(
            json.dumps(
                {
                    "building": building,
                    "roof_analysis": roof_analysis,
                    "texture_path": str(texture_path.resolve()),
                    "output_path": str(output_path),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        command = build_blender_command(
            self.executable.resolve(), self.script_path.resolve(), config_path
        )
        try:
            result = subprocess.run(
                command,
                cwd=str(Path(job_dir).resolve()),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout_seconds,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise BlenderGenerationError(
                f"Blender generation timed out after {self.timeout_seconds} seconds"
            ) from exc
        except OSError as exc:
            raise BlenderGenerationError(f"Failed to start Blender: {exc}") from exc

        (artifact_dir / "blender_stdout.log").write_text(
            result.stdout, encoding="utf-8"
        )
        (artifact_dir / "blender_stderr.log").write_text(
            result.stderr, encoding="utf-8"
        )
        if result.returncode != 0:
            details = (result.stderr or result.stdout).strip()[-1200:]
            raise BlenderGenerationError(
                f"Blender exited with code {result.returncode}: {details}"
            )
        if not output_path.is_file() or output_path.stat().st_size < 12:
            raise BlenderGenerationError("Blender did not produce a valid GLB file")
        if output_path.read_bytes()[:4] != b"glTF":
            raise BlenderGenerationError("Generated artifact is not a binary GLB")
        return output_path
