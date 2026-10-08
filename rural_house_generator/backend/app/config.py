from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
GENERATOR_DIR = BACKEND_DIR.parent


def resolve_runtime_root() -> Path:
    override = str(os.environ.get("RURAL_FACADE_RUNTIME_ROOT", "")).strip()
    if override:
        return Path(override).expanduser()
    local_app_data = str(os.environ.get("LOCALAPPDATA", "")).strip()
    if local_app_data:
        return Path(local_app_data) / "VillageFacadeGenerator" / "runtime_storage"
    xdg_cache = str(os.environ.get("XDG_CACHE_HOME", "")).strip()
    cache_root = Path(xdg_cache).expanduser() if xdg_cache else Path.home() / ".cache"
    return cache_root / "village-facade-generator" / "runtime_storage"


DEFAULT_RUNTIME_ROOT = resolve_runtime_root()
MAX_PHOTO_BYTES = 10 * 1024 * 1024
SUPPORTED_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
