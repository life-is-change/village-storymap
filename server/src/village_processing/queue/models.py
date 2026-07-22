from dataclasses import dataclass
from pathlib import Path

from village_processing.contracts import ProcessingParameters, ProcessingRequest


@dataclass(frozen=True)
class QueuedRun:
    run_id: str
    owner_id: str
    village_id: str
    requested_steps: tuple[str, ...]
    aoi: dict
    parameters: dict

    @classmethod
    def from_row(cls, row: dict) -> "QueuedRun":
        return cls(
            run_id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            village_id=str(row["village_id"]),
            requested_steps=tuple(row["requested_steps"]),
            aoi=row["aoi"],
            parameters=row.get("parameters") or {},
        )

    def processing_request(self, work_root: Path) -> ProcessingRequest:
        parameters = self.parameters
        return ProcessingRequest(
            run_id=self.run_id,
            village_id=self.village_id,
            aoi=self.aoi,
            requested_steps=self.requested_steps,
            parameters=ProcessingParameters.from_dict({
                "building_threshold": parameters.get("building_threshold", 0.5),
                "contour_interval": parameters.get("contour_interval", parameters.get("contour_interval_m", 10)),
                "contour_smoothing": parameters.get("contour_smoothing", 1),
            }),
            work_dir=Path(work_root).resolve() / "runs" / self.run_id,
        )
