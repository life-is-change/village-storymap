import json
from pathlib import Path

import cv2
import numpy as np

from rural_house_generator.backend.app.facade.auto_rectify import RectificationResult
from rural_house_generator.backend.app.facade.job_processor import FacadeJobProcessor


class FakeRectifier:
    def rectify_file(self, source_path: Path, artifact_dir: Path) -> RectificationResult:
        image = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        mask = np.full(image.shape[:2], 255, dtype=np.uint8)
        assert cv2.imwrite(str(artifact_dir / "building_mask_rectified.png"), mask)
        return RectificationResult(
            image=np.ascontiguousarray(image),
            diagnostics={"method": "fake-full-local", "resample_passes": 1},
        )


class FakeBlender:
    def generate(self, job_dir: Path, building: dict, texture_path: Path, roof_analysis=None):
        artifact_dir = job_dir / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        output = artifact_dir / "building.glb"
        output.write_bytes(b"glTF" + b"\x00" * 24)
        (artifact_dir / "model_manifest.json").write_text(
            json.dumps({"building": building, "texture": texture_path.name}),
            encoding="utf-8",
        )
        return output


def write_source(path: Path, *, height: int = 40, width: int = 80) -> None:
    image = np.full((height, width, 3), 180, dtype=np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    assert cv2.imwrite(str(path), image)


def test_rectify_writes_worker_artifacts_without_fastapi(tmp_path):
    source = tmp_path / "input.jpg"
    write_source(source)
    processor = FacadeJobProcessor(rectifier=FakeRectifier(), blender=FakeBlender())

    result = processor.rectify(source, tmp_path / "job")

    assert result.source.name == "rectified_source.png"
    assert result.preview.name == "rectified_preview.jpg"
    assert result.building_mask.name == "building_mask_rectified.png"
    assert result.diagnostics.name == "rectification_diagnostics.json"
    assert json.loads(result.diagnostics.read_text(encoding="utf-8"))["method"] == "fake-full-local"


def test_generate_reuses_rectification_and_validates_glb(tmp_path):
    rectified = tmp_path / "rectified_source.png"
    mask = tmp_path / "building_mask_rectified.png"
    write_source(rectified)
    cv2.imwrite(str(mask), np.full((40, 80), 255, dtype=np.uint8))
    processor = FacadeJobProcessor(rectifier=FakeRectifier(), blender=FakeBlender())

    result = processor.generate(
        rectified,
        mask,
        tmp_path / "job",
        crop_top=0.18,
        building={
            "width": 10,
            "depth": 8,
            "wall_height": 6,
            "roof_height": 1.08,
            "roof_type": "gable",
        },
    )

    assert result.texture.name == "facade_texture.png"
    assert result.glb.read_bytes()[:4] == b"glTF"
    assert result.manifest.name == "model_manifest.json"
    assert result.building["wall_height"] == 4.125


def test_generate_rejects_non_glb_output(tmp_path):
    class BrokenBlender(FakeBlender):
        def generate(self, job_dir: Path, building: dict, texture_path: Path, roof_analysis=None):
            output = super().generate(job_dir, building, texture_path, roof_analysis)
            output.write_bytes(b"not-a-glb")
            return output

    rectified = tmp_path / "rectified_source.png"
    write_source(rectified)
    processor = FacadeJobProcessor(rectifier=FakeRectifier(), blender=BrokenBlender())

    try:
        processor.generate(
            rectified,
            None,
            tmp_path / "job",
            crop_top=0.0,
            building={"width": 10, "depth": 8, "roof_type": "gable"},
        )
    except ValueError as exc:
        assert str(exc) == "GENERATED_GLB_INVALID"
    else:
        raise AssertionError("invalid GLB was accepted")
