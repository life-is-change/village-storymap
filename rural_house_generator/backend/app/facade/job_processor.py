from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..blender_service import BlenderService
from ..roof_profile import resolve_roof_profile
from .auto_rectify import RectificationResult
from .direct_crop import crop_facade_body
from .image_io import read_image, write_image


@dataclass(frozen=True)
class RectificationArtifacts:
    source: Path
    preview: Path
    building_mask: Path
    diagnostics: Path


@dataclass(frozen=True)
class GenerationArtifacts:
    texture: Path
    glb: Path
    manifest: Path
    building: dict[str, object]


class FacadeJobProcessor:
    def __init__(self, rectifier, blender: BlenderService):
        self.rectifier = rectifier
        self.blender = blender

    def rectify(
        self,
        source_path: Path,
        job_dir: Path,
        *,
        use_original: bool = False,
    ) -> RectificationArtifacts:
        image = read_image(source_path)
        if image is None:
            raise ValueError("SOURCE_IMAGE_INVALID")
        artifact_dir = Path(job_dir) / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)

        if use_original:
            result = RectificationResult(
                image=np.ascontiguousarray(image),
                diagnostics={
                    "method": "user_original_fallback",
                    "resample_passes": 0,
                    "warning": "Automatic rectification was skipped by explicit user choice",
                },
            )
        elif hasattr(self.rectifier, "rectify_file"):
            result = self.rectifier.rectify_file(source_path, artifact_dir)
        else:
            result = self.rectifier.rectify(image)

        source = artifact_dir / "rectified_source.png"
        if not write_image(source, result.image, ".png"):
            raise ValueError("RECTIFIED_SOURCE_WRITE_FAILED")
        preview_image = result.image
        if preview_image.shape[1] > 900:
            preview_height = max(1, round(preview_image.shape[0] * 900 / preview_image.shape[1]))
            preview_image = cv2.resize(preview_image, (900, preview_height), cv2.INTER_AREA)
        preview = artifact_dir / "rectified_preview.jpg"
        if not write_image(preview, preview_image, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90]):
            raise ValueError("RECTIFIED_PREVIEW_WRITE_FAILED")

        building_mask = artifact_dir / "building_mask_rectified.png"
        diagnostics = artifact_dir / "rectification_diagnostics.json"
        diagnostics.write_text(
            json.dumps(result.diagnostics, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return RectificationArtifacts(source, preview, building_mask, diagnostics)

    def prepare_texture(
        self,
        rectified_path: Path,
        mask_path: Path | None,
        job_dir: Path,
        *,
        crop_top: float,
        building: dict[str, object],
    ) -> tuple[Path, dict[str, object]]:
        image = read_image(rectified_path)
        if image is None:
            raise ValueError("RECTIFIED_IMAGE_INVALID")
        content_mask = None
        if mask_path and Path(mask_path).is_file():
            content_mask = cv2.imdecode(
                np.fromfile(mask_path, np.uint8), cv2.IMREAD_GRAYSCALE
            )
        facade_body = crop_facade_body(image, crop_top, content_mask=content_mask)
        artifact_dir = Path(job_dir) / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        texture = artifact_dir / "facade_texture.png"
        if not write_image(texture, facade_body, ".png"):
            raise ValueError("FACADE_TEXTURE_WRITE_FAILED")

        resolved = dict(building)
        width = float(resolved["width"])
        wall_height = round(min(100.0, width * facade_body.shape[0] / facade_body.shape[1]), 3)
        roof = resolve_roof_profile(
            width=width,
            depth=float(resolved["depth"]),
            wall_height=wall_height,
            roof_type=str(resolved.get("roof_type", "gable")),
            roof_pitch=str(resolved.get("roof_pitch", "standard")),
            roof_material=str(resolved.get("roof_material", "gray_tile")),
        )
        resolved["wall_height"] = wall_height
        resolved["roof_height"] = round(float(roof["height"]), 3)
        resolved.setdefault("roof_pitch", "standard")
        resolved.setdefault("roof_material", "gray_tile")
        return texture, resolved

    def generate_prepared(
        self,
        texture_path: Path,
        job_dir: Path,
        building: dict[str, object],
        *,
        roof_analysis: dict[str, Any] | None = None,
    ) -> GenerationArtifacts:
        glb = self.blender.generate(
            job_dir=Path(job_dir),
            building=building,
            texture_path=texture_path,
            roof_analysis=roof_analysis,
        )
        glb = Path(glb)
        if not glb.is_file() or glb.stat().st_size < 12 or glb.read_bytes()[:4] != b"glTF":
            raise ValueError("GENERATED_GLB_INVALID")
        manifest = Path(job_dir) / "artifacts" / "model_manifest.json"
        if not manifest.is_file():
            manifest.write_text(
                json.dumps({"building": building}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return GenerationArtifacts(texture_path, glb, manifest, dict(building))

    def generate(
        self,
        rectified_path: Path,
        mask_path: Path | None,
        job_dir: Path,
        crop_top: float,
        building: dict[str, object],
    ) -> GenerationArtifacts:
        texture, resolved = self.prepare_texture(
            rectified_path,
            mask_path,
            job_dir,
            crop_top=crop_top,
            building=building,
        )
        return self.generate_prepared(texture, job_dir, resolved)
