import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .engine import BuildingEngine


def resolve_manifest_path(work_root: Path, manifest_path: Path) -> Path:
    root = Path(work_root).resolve()
    target = Path(manifest_path).resolve()
    if target != root and root not in target.parents:
        raise ValueError("MANIFEST_PATH_ESCAPE")
    return target


def _resolve_work_file(work_root: Path, relative: str) -> Path:
    candidate = Path(relative)
    if candidate.is_absolute():
        raise ValueError("WORK_PATH_ESCAPE")
    return resolve_manifest_path(work_root, work_root / candidate)


class ProcessBody(BaseModel):
    manifest_path: str


app = FastAPI(title="Village Building Inference", docs_url=None, redoc_url=None)
_engine: BuildingEngine | None = None


def _get_engine() -> BuildingEngine:
    global _engine
    if _engine is None:
        config = os.environ.get("PLATFORM_MODEL_CONFIG")
        checkpoint = os.environ.get("PLATFORM_MODEL_CHECKPOINT")
        if not config or not checkpoint:
            raise RuntimeError("MODEL_ENV_REQUIRED")
        _engine = BuildingEngine(Path(config), Path(checkpoint), os.environ.get("PLATFORM_MODEL_DEVICE", "cuda:0"))
    return _engine


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": _engine is not None}


@app.post("/process")
def process(body: ProcessBody):
    try:
        work_root = Path(os.environ["PLATFORM_WORK_ROOT"]).resolve()
        manifest_path = resolve_manifest_path(work_root, Path(body.manifest_path))
        manifest = json.loads(manifest_path.read_text("utf-8"))
        forbidden = {"config", "checkpoint", "config_path", "checkpoint_path"}.intersection(manifest)
        if forbidden:
            raise ValueError("MODEL_OVERRIDE_FORBIDDEN")
        artifact = _get_engine().process(
            _resolve_work_file(work_root, manifest["input_tif"]),
            _resolve_work_file(work_root, manifest["output_geojson"]),
            float(manifest.get("score_threshold", 0.35)),
        )
        return {
            "path": str(artifact.path),
            "feature_count": artifact.feature_count,
            "bbox": artifact.bbox,
            "sha256": artifact.sha256,
            "source": artifact.source,
        }
    except (KeyError, ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        status = 503 if str(exc) == "GPU_OUT_OF_MEMORY" else 500
        raise HTTPException(status_code=status, detail=str(exc)) from exc
