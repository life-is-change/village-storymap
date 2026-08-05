from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BuildingSpec(BaseModel):
    width: float = Field(gt=0, le=200)
    depth: float = Field(gt=0, le=200)
    wall_height: float = Field(gt=0, le=100)
    roof_height: float = Field(ge=0, le=50)
    roof_type: Literal["hip", "gable", "flat"] = "hip"


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


class JobRecord(BaseModel):
    id: str
    status: Literal["uploaded", "rectified", "prepared", "generated", "failed"]
    created_at: str
    updated_at: str
    building: BuildingSpec
    photos: list[PhotoRecord]
    artifacts: dict[str, str] = Field(default_factory=dict)
    error: str | None = None
