from __future__ import annotations

import hashlib
from pathlib import Path

from .models import FacadeRun


class FacadeCancelRequested(RuntimeError):
    def __init__(self):
        super().__init__("FACADE_CANCEL_REQUESTED")


class FacadePipeline:
    def __init__(self, gateway, processor, work_root: Path, worker_id: str):
        self.gateway = gateway
        self.processor = processor
        self.work_root = Path(work_root)
        self.worker_id = worker_id

    def work_dir(self, run: FacadeRun) -> Path:
        return self.work_root / "facade-runs" / run.run_id

    def execute(self, run: FacadeRun):
        if run.phase == "rectification":
            return self.rectify(run)
        return self.generate(run)

    def _check_canceled(self, run: FacadeRun) -> None:
        if self.gateway.is_cancel_requested(run.run_id):
            raise FacadeCancelRequested()
        self.gateway.assert_lease(run.run_id)

    def rectify(self, run: FacadeRun):
        job_dir = self.work_dir(run)
        input_path = job_dir / "inputs" / "source.jpg"
        self.gateway.set_state(
            run.run_id,
            self.worker_id,
            "rectifying",
            stage="downloading_photo",
            progress=2,
        )
        self._check_canceled(run)
        self.gateway.download_photo(run, input_path)
        self._check_canceled(run)
        artifacts = self.processor.rectify(input_path, job_dir)

        definitions = (
            ("rectified_source", artifacts.source, "image/png"),
            ("rectified_preview", artifacts.preview, "image/jpeg"),
            ("building_mask", artifacts.building_mask, "image/png"),
            ("diagnostics", artifacts.diagnostics, "application/json"),
        )
        published = []
        for artifact_type, path, content_type in definitions:
            if not path.is_file():
                raise ValueError(f"FACADE_ARTIFACT_MISSING:{artifact_type}")
            self._check_canceled(run)
            storage_path = self.gateway.upload_artifact(
                run,
                self.worker_id,
                "rectification",
                artifact_type,
                path,
                content_type,
                {"phase": "rectification"},
            )
            content = path.read_bytes()
            published.append({
                "artifact_type": artifact_type,
                "storage_path": storage_path,
                "content_type": content_type,
                "size_bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "source": {"phase": "rectification"},
            })
        self._check_canceled(run)
        self.gateway.publish_rectification(run.run_id, self.worker_id, published)
        return artifacts

    def generate(self, run: FacadeRun):
        if (
            run.crop_top is None
            or run.roof_type is None
            or run.building_width is None
            or run.building_depth is None
        ):
            raise ValueError("FACADE_GENERATION_PARAMETERS_MISSING")
        job_dir = self.work_dir(run)
        artifact_dir = job_dir / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        rectified = artifact_dir / "rectified_source.png"
        mask = artifact_dir / "building_mask_rectified.png"

        self.gateway.set_state(
            run.run_id,
            self.worker_id,
            "generating",
            stage="restoring_rectification",
            progress=56,
        )
        if not rectified.is_file():
            self.gateway.download_artifact(run, "rectified_source", rectified)
        if not mask.is_file():
            self.gateway.download_artifact(run, "building_mask", mask)
        self._check_canceled(run)

        building = {
            "width": run.building_width,
            "depth": run.building_depth,
            "roof_type": run.roof_type,
            "roof_pitch": "standard",
            "roof_material": "gray_tile",
        }
        texture, resolved = self.processor.prepare_texture(
            rectified,
            mask,
            job_dir,
            crop_top=run.crop_top,
            building=building,
        )
        self._check_canceled(run)
        generated = self.processor.generate_prepared(texture, job_dir, resolved)
        if (
            not generated.glb.is_file()
            or generated.glb.stat().st_size < 12
            or generated.glb.read_bytes()[:4] != b"glTF"
        ):
            raise ValueError("GENERATED_GLB_INVALID")
        self._check_canceled(run)
        self.gateway.complete_generation(
            run,
            self.worker_id,
            generated.glb,
            {
                "phase": "generation",
                "generation_revision": run.generation_revision,
                "building": generated.building,
            },
        )
        return generated
