from dataclasses import dataclass


@dataclass(frozen=True)
class FacadeRun:
    run_id: str
    owner_id: str
    photo_id: int
    object_code: str
    space_id: str
    status: str
    generation_revision: int
    crop_top: float | None = None
    roof_type: str | None = None
    building_width: float | None = None
    building_depth: float | None = None

    @classmethod
    def from_row(cls, row: dict) -> "FacadeRun":
        return cls(
            run_id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            photo_id=int(row["photo_id"]),
            object_code=str(row["object_code"]),
            space_id=str(row["space_id"]),
            status=str(row["status"]),
            generation_revision=int(row.get("generation_revision") or 0),
            crop_top=_optional_float(row.get("crop_top")),
            roof_type=str(row["roof_type"]) if row.get("roof_type") else None,
            building_width=_optional_float(row.get("building_width")),
            building_depth=_optional_float(row.get("building_depth")),
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

