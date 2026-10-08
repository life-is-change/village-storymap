from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BuildingSpec(BaseModel):
    width: float = Field(gt=0, le=200)
    depth: float = Field(gt=0, le=200)
    wall_height: float = Field(gt=0, le=100)
    roof_height: float = Field(ge=0, le=50)
    roof_type: Literal["hip", "gable", "flat"] = "hip"
    roof_material: Literal[
        "gray_tile", "asphalt_shingle", "terracotta_tile"
    ] = "gray_tile"
    roof_pitch: Literal["low", "standard", "high"] = "standard"


class PhotoRecord(BaseModel):
    filename: str
    original_name: str
    content_type: Literal["image/jpeg", "image/png"]
    size_bytes: int = Field(ge=0)


class NormalizedPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class PrepareRequest(BaseModel):
    photo_index: int = Field(ge=0)
    corners: list[NormalizedPoint] = Field(min_length=4, max_length=4)


class RoofTypeDecision(BaseModel):
    value: Literal["hip", "gable", "flat"]
    confidence: float = Field(ge=0, le=1)
    source: Literal["automatic", "fallback", "manual"]


class RoofMaterialDecision(BaseModel):
    value: Literal["gray_tile", "asphalt_shingle", "terracotta_tile"]
    confidence: float = Field(ge=0, le=1)
    source: Literal["automatic", "fallback", "manual"]


class RoofPitchDecision(BaseModel):
    value: Literal["low", "standard", "high"]
    confidence: float = Field(ge=0, le=1)
    source: Literal["automatic", "fallback", "manual"]


class RoofAnalysis(BaseModel):
    type: RoofTypeDecision
    material: RoofMaterialDecision
    pitch: RoofPitchDecision
    crop_top: float = Field(ge=0, le=0.65)
    revision: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)
    detected_features: list[str] = Field(default_factory=list)


class JobRecord(BaseModel):
    id: str
    status: Literal["uploaded", "rectified", "prepared", "generated", "failed"]
    created_at: str
    updated_at: str
    building: BuildingSpec
    photos: list[PhotoRecord]
    artifacts: dict[str, str] = Field(default_factory=dict)
    roof_analysis: RoofAnalysis | None = None
    error: str | None = None
