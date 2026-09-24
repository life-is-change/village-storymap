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
    display_name: str
    imagery: Path
    dem: Path
    osm: Path
    bounds: tuple[float, float, float, float]
    model_config: Path
    model_checkpoint: Path
    osm_snapshot: str
    dem_source: str


class DatasetCatalog:
    def __init__(self, items: Mapping[str, VillageDataset], aliases: Mapping[str, str] | None = None):
        self._items = dict(items)
        self._aliases = dict(aliases or {})

    def village_ids(self) -> tuple[str, ...]:
        return tuple(self._items)

    def bounds(self, village_id: str) -> tuple[float, float, float, float] | None:
        item = self._items.get(self._aliases.get(village_id, village_id))
        return item.bounds if item else None

    def status(self, village_id: str) -> str:
        item = self._items.get(self._aliases.get(village_id, village_id))
        if item is None:
            return "LOCAL_SOURCE_NOT_REGISTERED"
        paths = (item.imagery, item.dem, item.osm, item.model_config, item.model_checkpoint)
        for index, path in enumerate(paths):
            try:
                with path.open("rb"):
                    pass
            except OSError:
                return "LOCAL_IMAGERY_MISSING" if index == 0 else "LOCAL_SHARED_SOURCE_MISSING"
        return "ready"

    def resolve(self, village_id: str) -> VillageDataset:
        item = self._items.get(self._aliases.get(village_id, village_id))
        if item is None:
            raise FileNotFoundError("LOCAL_SOURCE_NOT_REGISTERED")
        status = self.status(village_id)
        if status != "ready":
            raise FileNotFoundError(status)
        return item


def load_catalog(path: Path, data_root: Path) -> DatasetCatalog:
    payload = yaml.safe_load(Path(path).read_text("utf-8")) or {}
    raw_items = payload.get("villages", {})
    if not isinstance(raw_items, dict):
        raise ValueError("INVALID_DATASET_CATALOG")

    shared = payload.get("shared") or {}
    if not isinstance(shared, dict):
        raise ValueError("INVALID_DATASET_CATALOG")
    items: dict[str, VillageDataset] = {}
    aliases: dict[str, str] = {}
    for village_id, raw in raw_items.items():
        if not isinstance(raw, dict):
            raise ValueError("INVALID_DATASET_CATALOG")
        try:
            paths = {
                field: resolve_under_root(data_root, str(raw[field] if field in raw else shared[field]))
                for field in ("imagery", "dem", "osm", "model_config", "model_checkpoint")
            }
            bounds = tuple(float(value) for value in raw["bounds"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("INVALID_DATASET_CATALOG") from exc
        if len(bounds) != 4 or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise ValueError("INVALID_DATASET_BOUNDS")
        items[str(village_id)] = VillageDataset(
            village_id=str(village_id),
            display_name=str(raw.get("display_name", village_id)),
            bounds=bounds,
            osm_snapshot=str(raw.get("osm_snapshot", shared.get("osm_snapshot", "unknown"))),
            dem_source=str(raw.get("dem_source", shared.get("dem_source", "unknown"))),
            **paths,
        )
        for alias in raw.get("aliases", ()):
            alias = str(alias)
            if alias in items or alias in aliases:
                raise ValueError("DUPLICATE_DATASET_ALIAS")
            aliases[alias] = str(village_id)
    return DatasetCatalog(items, aliases)
