from __future__ import annotations

import re
import os
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .blender_service import (
    BlenderGenerationError,
    BlenderService,
    BlenderUnavailableError,
    MissingTextureError,
)
from .config import MAX_PHOTO_BYTES, SUPPORTED_PHOTO_TYPES, resolve_runtime_root
from .facade.perspective import (
    InvalidCornersError,
    normalized_to_pixels,
    rectify_facade,
)
from .facade.image_io import read_image, write_image
from .facade.direct_crop import crop_facade_body
from .facade.auto_rectify import (
    AutoFacadeRectifier,
    FacadeRectificationError,
    RectificationResult,
)
from .facade.full_pipeline import FullLocalFacadeRectifier
from .job_store import DiskJobStore, JobNotFoundError
from .schemas import (
    BuildingSpec,
    JobRecord,
    PhotoRecord,
    PrepareRequest,
    RoofAnalysis,
)
from .roof_analysis import analyze_roof, fallback_roof_analysis
from .roof_profile import resolve_roof_profile


def _safe_stem(filename: str | None) -> str:
    stem = Path(filename or "photo").stem
    sanitized = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-_")
    return sanitized or "photo"


def create_app(
    runtime_root: Path | None = None,
    blender_executable: Path | None = None,
    facade_rectifier=None,
) -> FastAPI:
    application = FastAPI(title="Rural Facade Generator", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(?:localhost|127\.0\.0\.1)(?::\d+)?",
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    store = DiskJobStore(runtime_root or resolve_runtime_root())
    blender = BlenderService(
        executable=blender_executable
        or Path(os.environ.get("BLENDER_EXECUTABLE", r"D:\Blender\blender.exe"))
    )
    application.state.job_store = store
    application.state.blender_service = blender
    if facade_rectifier is not None:
        selected_rectifier = facade_rectifier
    elif os.environ.get("RURAL_FACADE_PIPELINE", "legacy").strip().lower() == "full-local":
        selected_rectifier = FullLocalFacadeRectifier()
    else:
        selected_rectifier = AutoFacadeRectifier()
    application.state.facade_rectifier = selected_rectifier

    @application.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "rural-facade-generator",
            "runtime_root": str(store.runtime_root.resolve()),
        }

    @application.post(
        "/api/jobs", response_model=JobRecord, status_code=status.HTTP_201_CREATED
    )
    async def create_job(
        photos: list[UploadFile] = File(...),
        building_width: float = Form(...),
        building_depth: float = Form(...),
        wall_height: float = Form(...),
        roof_height: float = Form(...),
        roof_type: str = Form("gable"),
        roof_material: str = Form("gray_tile"),
        roof_pitch: str = Form("standard"),
    ) -> JobRecord:
        building = BuildingSpec(
            width=building_width,
            depth=building_depth,
            wall_height=wall_height,
            roof_height=roof_height,
            roof_type=roof_type,
            roof_material=roof_material,
            roof_pitch=roof_pitch,
        )
        if not photos:
            raise HTTPException(status_code=422, detail="At least one photo is required")

        job_id = str(uuid4())
        now = datetime.now(UTC).isoformat()
        record = JobRecord(
            id=job_id,
            status="uploaded",
            created_at=now,
            updated_at=now,
            building=building,
            photos=[],
        ).model_dump(mode="json")
        store.create(record)

        photo_records: list[PhotoRecord] = []
        try:
            for index, photo in enumerate(photos, start=1):
                if photo.content_type not in SUPPORTED_PHOTO_TYPES:
                    raise HTTPException(
                        status_code=415,
                        detail="Only JPEG and PNG photos are supported",
                    )
                content = await photo.read(MAX_PHOTO_BYTES + 1)
                if len(content) > MAX_PHOTO_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Each photo must be 10 MB or smaller",
                    )
                extension = SUPPORTED_PHOTO_TYPES[photo.content_type]
                filename = f"{index:03d}-{_safe_stem(photo.filename)}{extension}"
                (store.job_dir(job_id) / "inputs" / filename).write_bytes(content)
                photo_records.append(
                    PhotoRecord(
                        filename=filename,
                        original_name=Path(photo.filename or "photo").name,
                        content_type=photo.content_type,
                        size_bytes=len(content),
                    )
                )
        except Exception:
            record["status"] = "failed"
            record["error"] = "Upload validation failed"
            record["updated_at"] = datetime.now(UTC).isoformat()
            store.write(job_id, record)
            raise

        record["photos"] = [item.model_dump(mode="json") for item in photo_records]
        record["updated_at"] = datetime.now(UTC).isoformat()
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.get("/api/jobs/{job_id}", response_model=JobRecord)
    def get_job(job_id: str) -> JobRecord:
        try:
            return JobRecord.model_validate(store.get(job_id))
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

    @application.post("/api/jobs/{job_id}/rectify", response_model=JobRecord)
    def rectify_job(
        job_id: str,
        use_original: bool = Query(default=False),
    ) -> JobRecord:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc
        if len(record["photos"]) != 1:
            raise HTTPException(status_code=422, detail="Rectification requires exactly one image")
        photo_record = record["photos"][0]
        photo_path = store.job_dir(job_id) / "inputs" / photo_record["filename"]
        image = read_image(photo_path)
        if image is None:
            raise HTTPException(status_code=422, detail="Uploaded image cannot be decoded")
        if use_original:
            result = RectificationResult(
                image=np.ascontiguousarray(image),
                diagnostics={
                    "method": "user_original_fallback",
                    "resample_passes": 0,
                    "warning": "Automatic rectification was skipped by explicit user choice",
                },
            )
        else:
            try:
                rectifier = application.state.facade_rectifier
                if hasattr(rectifier, "rectify_file"):
                    result = rectifier.rectify_file(photo_path, store.job_dir(job_id) / "artifacts")
                else:
                    result = rectifier.rectify(image)
            except FacadeRectificationError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

        artifact_dir = store.job_dir(job_id) / "artifacts"
        artifact_dir.mkdir(exist_ok=True)
        source_path = artifact_dir / "rectified_source.png"
        if not write_image(source_path, result.image, ".png"):
            raise HTTPException(status_code=500, detail="Failed to save rectified facade")
        preview = result.image
        if preview.shape[1] > 900:
            preview_height = max(1, round(preview.shape[0] * 900 / preview.shape[1]))
            preview = cv2.resize(preview, (900, preview_height), cv2.INTER_AREA)
        preview_path = artifact_dir / "rectified_preview.jpg"
        if not write_image(preview_path, preview, ".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90]):
            raise HTTPException(status_code=500, detail="Failed to save rectified preview")
        diagnostics_path = artifact_dir / "rectification_diagnostics.json"
        diagnostics_path.write_text(
            json.dumps(result.diagnostics, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        record["status"] = "rectified"
        record["roof_analysis"] = None
        record["updated_at"] = datetime.now(UTC).isoformat()
        for downstream in ("rectified_facade", "building_glb", "model_manifest"):
            record["artifacts"].pop(downstream, None)
        record["artifacts"].update({
            "rectified_source": "artifacts/rectified_source.png",
            "rectified_preview": "artifacts/rectified_preview.jpg",
            "rectification_diagnostics": "artifacts/rectification_diagnostics.json",
        })
        for name in (
            "building_mask_source.png",
            "building_mask_rectified.png",
            "ml/building_mask.png",
            "ml/occlusion_mask.png",
            "ml/model_diagnostics.json",
        ):
            path = artifact_dir / name
            if path.is_file():
                record["artifacts"][Path(name).stem] = f"artifacts/{name}"
        record["error"] = None
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.post(
        "/api/jobs/{job_id}/analyze-roof", response_model=JobRecord
    )
    def analyze_roof_job(
        job_id: str,
        roof_top_norm: float = Form(..., ge=0, le=0.65),
        revision: int = Form(..., ge=0),
        roof_type_override: Literal["hip", "gable", "flat"] | None = Form(
            default=None
        ),
        roof_material_override: Literal[
            "gray_tile", "asphalt_shingle", "terracotta_tile"
        ]
        | None = Form(default=None),
        roof_pitch_override: Literal["low", "standard", "high"] | None = Form(
            default=None
        ),
    ) -> JobRecord:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

        if record["status"] != "rectified":
            raise HTTPException(
                status_code=409,
                detail="Job must be rectified before roof analysis",
            )
        current = record.get("roof_analysis")
        if current is not None and revision <= int(current.get("revision", -1)):
            return JobRecord.model_validate(record)

        relative_source = record["artifacts"].get("rectified_source")
        if not relative_source:
            raise HTTPException(
                status_code=409,
                detail="Job must be rectified before roof analysis",
            )
        image = read_image(store.job_dir(job_id) / relative_source)
        if image is None:
            raise HTTPException(status_code=422, detail="Rectified image cannot be decoded")

        building_mask = None
        relative_mask = record["artifacts"].get("building_mask_rectified")
        if relative_mask:
            mask_path = store.job_dir(job_id) / relative_mask
            if mask_path.is_file():
                building_mask = cv2.imdecode(
                    np.fromfile(mask_path, np.uint8), cv2.IMREAD_GRAYSCALE
                )
        try:
            resolved = analyze_roof(image, roof_top_norm, building_mask)
        except Exception:
            resolved = fallback_roof_analysis(roof_top_norm)

        overrides = {
            "type": roof_type_override,
            "material": roof_material_override,
            "pitch": roof_pitch_override,
        }
        for key, override in overrides.items():
            previous = current.get(key) if current else None
            if override is not None:
                resolved[key] = {
                    "value": override,
                    "confidence": 1.0,
                    "source": "manual",
                }
            elif previous and previous.get("source") == "manual":
                resolved[key] = previous
        resolved["revision"] = revision
        analysis = RoofAnalysis.model_validate(resolved).model_dump(mode="json")
        record["roof_analysis"] = analysis
        record["building"]["roof_type"] = analysis["type"]["value"]
        record["building"]["roof_material"] = analysis["material"]["value"]
        record["building"]["roof_pitch"] = analysis["pitch"]["value"]
        record["updated_at"] = datetime.now(UTC).isoformat()
        record["error"] = None
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.post(
        "/api/jobs/{job_id}/prepare-direct", response_model=JobRecord
    )
    def prepare_direct_job(
        job_id: str,
        crop_top: float = Query(default=0.0, ge=0, le=0.65),
    ) -> JobRecord:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

        if len(record["photos"]) != 1:
            raise HTTPException(
                status_code=422,
                detail="Direct texture workflow requires exactly one image",
            )

        relative_rectified = record["artifacts"].get("rectified_source")
        if record["status"] != "rectified" or not relative_rectified:
            raise HTTPException(status_code=409, detail="Job must be rectified before roof cropping")
        photo_path = store.job_dir(job_id) / relative_rectified
        image = read_image(photo_path)
        if image is None:
            raise HTTPException(
                status_code=422, detail="Uploaded image cannot be decoded"
            )

        artifact_dir = store.job_dir(job_id) / "artifacts"
        artifact_dir.mkdir(exist_ok=True)
        texture_path = artifact_dir / "facade_texture.png"
        content_mask = None
        relative_mask = record["artifacts"].get("building_mask_rectified")
        if relative_mask:
            mask_path = store.job_dir(job_id) / relative_mask
            content_mask = cv2.imdecode(
                np.fromfile(mask_path, np.uint8), cv2.IMREAD_GRAYSCALE
            ) if mask_path.is_file() else None
        facade_body = crop_facade_body(image, crop_top, content_mask=content_mask)
        if not write_image(texture_path, facade_body, ".png"):
            raise HTTPException(
                status_code=500, detail="Failed to save facade texture"
            )

        front_length = float(record["building"]["width"])
        wall_height = round(
            min(100.0, front_length * facade_body.shape[0] / facade_body.shape[1]),
            3,
        )
        roof = resolve_roof_profile(
            width=float(record["building"]["width"]),
            depth=float(record["building"]["depth"]),
            wall_height=wall_height,
            roof_type=str(record["building"]["roof_type"]),
            roof_pitch=str(record["building"].get("roof_pitch", "standard")),
            roof_material=str(
                record["building"].get("roof_material", "gray_tile")
            ),
        )
        record["building"]["wall_height"] = wall_height
        record["building"]["roof_height"] = round(float(roof["height"]), 3)
        record["status"] = "prepared"
        record["updated_at"] = datetime.now(UTC).isoformat()
        record["artifacts"]["rectified_facade"] = "artifacts/facade_texture.png"
        record["error"] = None
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.post("/api/jobs/{job_id}/prepare", response_model=JobRecord)
    def prepare_job(job_id: str, request: PrepareRequest) -> JobRecord:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

        if request.photo_index >= len(record["photos"]):
            raise HTTPException(status_code=422, detail="Photo index is out of range")

        photo_record = record["photos"][request.photo_index]
        photo_path = store.job_dir(job_id) / "inputs" / photo_record["filename"]
        image = read_image(photo_path)
        if image is None:
            raise HTTPException(status_code=422, detail="Uploaded photo cannot be decoded")

        normalized = np.float32([[point.x, point.y] for point in request.corners])
        try:
            pixel_corners = normalized_to_pixels(
                normalized, image_width=image.shape[1], image_height=image.shape[0]
            )
            rectified = rectify_facade(image, pixel_corners)
        except InvalidCornersError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        artifact_dir = store.job_dir(job_id) / "artifacts"
        artifact_dir.mkdir(exist_ok=True)
        rectified_path = artifact_dir / "rectified_facade.png"
        if not write_image(rectified_path, rectified, ".png"):
            raise HTTPException(status_code=500, detail="Failed to save rectified facade")

        preview = rectified
        if preview.shape[1] > 640:
            preview_height = max(1, round(preview.shape[0] * 640 / preview.shape[1]))
            preview = cv2.resize(preview, (640, preview_height), cv2.INTER_AREA)
        preview_path = artifact_dir / "rectified_preview.jpg"
        if not write_image(
            preview_path,
            preview,
            ".jpg",
            [cv2.IMWRITE_JPEG_QUALITY, 88],
        ):
            raise HTTPException(status_code=500, detail="Failed to save facade preview")

        record["status"] = "prepared"
        record["updated_at"] = datetime.now(UTC).isoformat()
        record["artifacts"].update(
            {
                "rectified_facade": "artifacts/rectified_facade.png",
                "rectified_preview": "artifacts/rectified_preview.jpg",
            }
        )
        record["error"] = None
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.post("/api/jobs/{job_id}/generate", response_model=JobRecord)
    def generate_job(job_id: str) -> JobRecord:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

        relative_texture = record["artifacts"].get("rectified_facade")
        if record["status"] != "prepared" or not relative_texture:
            raise HTTPException(status_code=409, detail="Job must be prepared first")
        texture_path = store.job_dir(job_id) / relative_texture
        try:
            blender.generate(
                job_dir=store.job_dir(job_id),
                building=record["building"],
                texture_path=texture_path,
                roof_analysis=record.get("roof_analysis"),
            )
        except (BlenderUnavailableError, MissingTextureError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except BlenderGenerationError as exc:
            record["status"] = "failed"
            record["error"] = str(exc)
            record["updated_at"] = datetime.now(UTC).isoformat()
            store.write(job_id, record)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        record["status"] = "generated"
        record["updated_at"] = datetime.now(UTC).isoformat()
        record["artifacts"]["building_glb"] = "artifacts/building.glb"
        manifest_path = store.job_dir(job_id) / "artifacts" / "model_manifest.json"
        if manifest_path.is_file():
            record["artifacts"]["model_manifest"] = "artifacts/model_manifest.json"
        record["error"] = None
        store.write(job_id, record)
        return JobRecord.model_validate(record)

    @application.get("/api/jobs/{job_id}/artifacts/{artifact_name}")
    def download_artifact(job_id: str, artifact_name: str) -> FileResponse:
        try:
            record = store.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

        matching_path = next(
            (
                relative_path
                for relative_path in record["artifacts"].values()
                if Path(relative_path).name == artifact_name
            ),
            None,
        )
        if matching_path is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        artifact_path = store.job_dir(job_id) / matching_path
        if not artifact_path.is_file():
            raise HTTPException(status_code=404, detail="Artifact not found")
        media_type = (
            "model/gltf-binary"
            if artifact_path.suffix.lower() == ".glb"
            else "application/octet-stream"
        )
        return FileResponse(
            artifact_path, media_type=media_type, filename=artifact_path.name
        )

    return application


app = create_app()
