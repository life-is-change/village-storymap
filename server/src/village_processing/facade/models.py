from dataclasses import dataclass


@dataclass(frozen=True)
class FacadeRun:
    run_id: str
    owner_id: str
    photo_id: int | None
    object_code: str
    space_id: str
    status: str
    generation_revision: int
    source_photo_path: str | None = None
    source_photo_url: str | None = None
    crop_top: float | None = None
    roof_type: str | None = None
    building_width: float | None = None
    building_depth: float | None = None
    origin_instance_id: str = "supabase"
    source_photo_bucket: str = "house-photos"
    source_photo_sha256: str | None = None
    source_photo_size: int | None = None
    source_photo_mime: str | None = None
    generation_method: str = 'texture'
    model_purpose: str = 'existing'
    component_options: dict | None = None

    @classmethod
    def from_row(cls, row: dict) -> "FacadeRun":
        return cls(
            run_id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            photo_id=int(row["photo_id"]) if row.get("photo_id") is not None else None,
            object_code=str(row["object_code"]),
            space_id=str(row["space_id"]),
            status=str(row["status"]),
            generation_revision=int(row.get("generation_revision") or 0),
            source_photo_path=str(row["source_photo_path"]) if row.get("source_photo_path") else None,
            source_photo_url=str(row["source_photo_url"]) if row.get("source_photo_url") else None,
            crop_top=_optional_float(row.get("crop_top")),
            roof_type=str(row["roof_type"]) if row.get("roof_type") else None,
            building_width=_optional_float(row.get("building_width")),
            building_depth=_optional_float(row.get("building_depth")),
            origin_instance_id=str(row.get("origin_instance_id") or "supabase"),
            source_photo_bucket=str(row.get("source_photo_bucket") or "house-photos"),
            source_photo_sha256=row.get("source_photo_sha256"),
            source_photo_size=int(row["source_photo_size"]) if row.get("source_photo_size") is not None else None,
            source_photo_mime=row.get("source_photo_mime"),
            generation_method=str(row.get('generation_method') or 'texture'),
            model_purpose=str(row.get('model_purpose') or 'existing'),
            component_options=row.get('component_options') or {},
        )

    @property
    def phase(self) -> str:
        if "rectification" in self.status:
            return "rectification"
        if "generation" in self.status:
            return "generation"
        raise ValueError(f"UNCLAIMABLE_FACADE_STATUS:{self.status}")


def _optional_float(value) -> float | None:
    return float(value) if value is not None else None
