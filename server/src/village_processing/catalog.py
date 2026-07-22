from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import yaml


def resolve_under_root(root: Path, relative: str) -> Path:
    root = root.resolve()
    candidate = Path(relative)
    if candidate.is_absolute():
        raise ValueError("DATASET_PATH_ESCAPE")
    target = (root / candidate).resolve()
    if target != root and root not in target.parents:
        raise ValueError("DATASET_PATH_ESCAPE")
    return target


@dataclass(frozen=True)
class VillageDataset:
    village_id: str
    imagery: Path
    dem: Path
    osm: Path
    bounds: tuple[float, float, float, float]
    model_config: Path
    model_checkpoint: Path
    osm_snapshot: str
    dem_source: str


class DatasetCatalog:
    def __init__(self, items: Mapping[str, VillageDataset]):
        self._items = dict(items)

    def resolve(self, village_id: str) -> VillageDataset:
        try:
            return self._items[village_id]
        except KeyError as exc:
            raise KeyError("DATASET_NOT_REGISTERED") from exc


def load_catalog(path: Path, data_root: Path) -> DatasetCatalog:
    payload = yaml.safe_load(Path(path).read_text("utf-8")) or {}
    raw_items = payload.get("villages", {})
    if not isinstance(raw_items, dict):
        raise ValueError("INVALID_DATASET_CATALOG")

    items: dict[str, VillageDataset] = {}
    for village_id, raw in raw_items.items():
        if not isinstance(raw, dict):
            raise ValueError("INVALID_DATASET_CATALOG")
        paths = {
            field: resolve_under_root(data_root, str(raw[field]))
            for field in ("imagery", "dem", "osm", "model_config", "model_checkpoint")
        }
        missing = [str(value) for value in paths.values() if not value.is_file()]
        if missing:
            raise FileNotFoundError(f"DATASET_FILE_MISSING: {', '.join(missing)}")
        bounds = tuple(float(value) for value in raw["bounds"])
        if len(bounds) != 4 or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise ValueError("INVALID_DATASET_BOUNDS")
        items[str(village_id)] = VillageDataset(
            village_id=str(village_id),
            bounds=bounds,
            osm_snapshot=str(raw.get("osm_snapshot", "unknown")),
            dem_source=str(raw.get("dem_source", "unknown")),
            **paths,
        )
    return DatasetCatalog(items)
