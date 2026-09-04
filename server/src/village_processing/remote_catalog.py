"""Resolve a server-authorized remote dataset manifest into run-local files."""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import urlparse

import httpx

from village_processing.catalog import VillageDataset

MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
REQUIRED_FILES = ("imagery", "dem", "osm", "model_config", "model_checkpoint")
DEFAULT_ALLOWED_HOSTS = {"rzmbmwauomzwiyenafha.supabase.co"}


def _download_stream(url: str, target: Path) -> None:
    size = 0
    with httpx.stream("GET", url, timeout=600, follow_redirects=False) as response:
        response.raise_for_status()
        with target.open("wb") as output:
            for chunk in response.iter_bytes(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ValueError("DATASET_FILE_TOO_LARGE")
                output.write(chunk)


class RemoteDatasetResolver:
    def __init__(self, download=None, allowed_hosts=None):
        self.download = download or _download_stream
        self.allowed_hosts = set(allowed_hosts or DEFAULT_ALLOWED_HOSTS)

    def _validate_file(self, item: dict) -> tuple[str, int, str]:
        if not isinstance(item, dict):
            raise ValueError("DATASET_MANIFEST_INVALID")
        url = str(item.get("url", ""))
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            raise ValueError("DATASET_URL_NOT_ALLOWED")
        size = item.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0 or size > MAX_FILE_BYTES:
            raise ValueError("DATASET_FILE_SIZE_INVALID")
        digest = str(item.get("sha256", "")).lower()
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValueError("DATASET_SHA256_INVALID")
        return url, size, digest

    def resolve(self, request, work_dir: str | Path) -> VillageDataset:
        manifest = request.input_manifest
        if not request.dataset_id or not isinstance(manifest, dict):
            raise ValueError("DATASET_MANIFEST_REQUIRED")
        files = manifest.get("files")
        if not isinstance(files, dict):
            raise ValueError("DATASET_MANIFEST_INVALID")
        target_root = Path(work_dir).resolve() / "dataset-inputs"
        target_root.mkdir(parents=True, exist_ok=True)
        suffixes = {
            "imagery": ".tif", "dem": ".tif", "osm": ".osm.pbf",
            "model_config": ".py", "model_checkpoint": ".pth",
        }
        paths = {}
        for key in REQUIRED_FILES:
            url, expected_size, expected_hash = self._validate_file(files.get(key))
            target = target_root / f"{key}{suffixes[key]}"
            self.download(url, target)
            if not target.is_file() or target.stat().st_size != expected_size:
                raise ValueError("DATASET_FILE_SIZE_MISMATCH")
            hasher = hashlib.sha256()
            with target.open("rb") as downloaded:
                while chunk := downloaded.read(1024 * 1024):
                    hasher.update(chunk)
            digest = hasher.hexdigest()
            if digest != expected_hash:
                raise ValueError("DATASET_SHA256_MISMATCH")
            paths[key] = target
        bounds = tuple(float(value) for value in manifest.get("bounds", ()))
        if len(bounds) != 4 or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise ValueError("INVALID_DATASET_BOUNDS")
        return VillageDataset(
            village_id=request.village_id,
            display_name=str(manifest.get("display_name") or request.village_id),
            imagery=paths["imagery"], dem=paths["dem"], osm=paths["osm"], bounds=bounds,
            model_config=paths["model_config"], model_checkpoint=paths["model_checkpoint"],
            osm_snapshot=str(manifest.get("osm_snapshot", "unknown")),
            dem_source=str(manifest.get("dem_source", "unknown")),
        )
