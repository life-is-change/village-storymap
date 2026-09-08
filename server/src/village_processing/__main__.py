import argparse
import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from .catalog import load_catalog
from .raster import crop_imagery
from .processors.osm import extract_osm_layers
from .processors.contours import generate_contours
from .contracts import ProcessingRequest
from .pipeline import NativeProcessors, resolve_run_request, run_pipeline
from .preview import generate_preview
from .health import run_facade_health_checks


def _geometry_from_file(path: Path) -> dict:
    payload = json.loads(path.read_text("utf-8"))
    return payload["geometry"] if payload.get("type") == "Feature" else payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="village_processing")
    subparsers = parser.add_subparsers(dest="command", required=True)
    catalog = subparsers.add_parser("catalog-check")
    catalog.add_argument("--catalog", type=Path, required=True)
    catalog.add_argument("--village", required=True)
    crop = subparsers.add_parser("crop-imagery")
    crop.add_argument("--catalog", type=Path, required=True)
    crop.add_argument("--village", required=True)
    crop.add_argument("--aoi", type=Path, required=True)
    crop.add_argument("--output", type=Path, required=True)
    osm = subparsers.add_parser("osm")
    osm.add_argument("--catalog", type=Path, required=True)
    osm.add_argument("--village", required=True)
    osm.add_argument("--aoi", type=Path, required=True)
    osm.add_argument("--output", type=Path, required=True)
    contours = subparsers.add_parser("contours")
    contours.add_argument("--catalog", type=Path, required=True)
    contours.add_argument("--village", required=True)
    contours.add_argument("--aoi", type=Path, required=True)
    contours.add_argument("--interval", type=int, choices=(5, 10), default=5)
    contours.add_argument("--smoothing", type=int, choices=(0, 1), default=1)
    contours.add_argument("--output", type=Path, required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--request", type=Path, required=True)
    run.add_argument("--catalog", type=Path, default=Path("server/config/villages.yaml"))
    preview = subparsers.add_parser("preview")
    preview.add_argument("--catalog", type=Path, default=Path("server/config/villages.yaml"))
    preview.add_argument("--village", required=True)
    preview.add_argument("--assets-root", type=Path, default=Path("assets"))
    preview.add_argument("--max-edge", type=int, default=2000)
    health = subparsers.add_parser("health")
    health.add_argument("--local", action="store_true")
    subparsers.add_parser("worker")
    subparsers.add_parser("facade-worker")
    return parser


def run_facade_worker() -> None:
    from supabase import create_client

    from rural_house_generator.backend.app.blender_service import BlenderService
    from rural_house_generator.backend.app.facade.full_pipeline import (
        FullLocalFacadeRectifier,
    )
    from rural_house_generator.backend.app.facade.job_processor import (
        FacadeJobProcessor,
    )

    from .facade.gateway import FacadeGateway
    from .facade.pipeline import FacadePipeline
    from .facade.worker import FacadeWorker

    work_root = Path(os.environ.get("FACADE_WORK_ROOT", "/work")).resolve()
    from uuid import uuid4
    worker_id = f'{os.environ.get("WORKER_ID", "linux-facade-worker")}-{uuid4().hex[:8]}'
    gateway = FacadeGateway(
        create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        )
    )
    processor = FacadeJobProcessor(
        rectifier=FullLocalFacadeRectifier(),
        blender=BlenderService(
            executable=Path(os.environ.get("BLENDER_EXECUTABLE", "/usr/bin/blender"))
        ),
    )
    pipeline = FacadePipeline(gateway, processor, work_root, worker_id)
    asyncio.run(FacadeWorker(gateway, pipeline, worker_id).run_forever())


def main(argv=None) -> int:
    server_root = Path(__file__).resolve().parents[2]
    load_dotenv(server_root / ".env")
    args = build_parser().parse_args(argv)
    if args.command == "health":
        return run_health_checks(check_remote=not args.local)
    if args.command == "facade-worker":
        if not os.environ.get("SUPABASE_URL"):
            raise SystemExit("SUPABASE_URL is required")
        if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
            raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is required")
        if run_facade_health_checks() != 0:
            raise SystemExit("Facade worker health checks failed")
        logging.basicConfig(
            level=os.environ.get("PLATFORM_LOG_LEVEL", "INFO"),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        run_facade_worker()
        return 0
    data_root = os.environ.get("PLATFORM_DATA_ROOT")
    if not data_root:
        raise SystemExit("PLATFORM_DATA_ROOT is required")
    if args.command == "worker":
        from supabase import create_client
        from .queue.gateway import SupabaseGateway
        from .remote_catalog import RemoteDatasetResolver
        from .worker import Worker

        work_root = Path(os.environ.get("PLATFORM_WORK_ROOT", "server/runtime")).resolve()
        catalog_path = Path(os.environ.get("PLATFORM_CATALOG", "server/config/villages.yaml"))
        catalog = load_catalog(catalog_path, Path(data_root))
        processors = NativeProcessors(
            work_root, os.environ.get("BUILDING_SERVICE_URL", "http://127.0.0.1:8021")
        )
        gateway = SupabaseGateway(create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        ))
        remote_resolver = RemoteDatasetResolver()
        pipeline_runner = lambda queued: run_pipeline(
            queued.processing_request(work_root), catalog, processors, remote_resolver
        )
        logging.basicConfig(
            level=os.environ.get("PLATFORM_LOG_LEVEL", "INFO"),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        worker = Worker(gateway, pipeline_runner, os.environ.get("WORKER_ID", "win11-pilot"))
        asyncio.run(worker.run_forever())
        return 0
    catalog = load_catalog(args.catalog, Path(data_root))
    if args.command == "run":
        work_root = Path(os.environ.get("PLATFORM_WORK_ROOT", "server/runtime"))
        request = resolve_run_request(ProcessingRequest.from_json(args.request), work_root)
        manifest = run_pipeline(request, catalog, NativeProcessors(work_root))
        print(json.dumps({
            "run_ok": True,
            "run_id": manifest.run_id,
            "artifacts": [item.artifact_type for item in manifest.artifacts],
            "warnings": manifest.warnings,
        }, ensure_ascii=False))
        return 0
    item = catalog.resolve(args.village)
    if args.command == "catalog-check":
        print(json.dumps({
            "catalog_ok": True,
            "village_id": item.village_id,
            "imagery": str(item.imagery),
            "dem": str(item.dem),
            "osm": str(item.osm),
            "bounds": item.bounds,
        }, ensure_ascii=False))
        return 0
    if args.command == "preview":
        entry = generate_preview(
            item.imagery,
            args.assets_root,
            item.village_id,
            item.display_name,
            args.max_edge,
        )
        print(json.dumps({"preview_ok": True, **entry}, ensure_ascii=False))
        return 0
    if args.command == "crop-imagery":
        crop_imagery(item.imagery, _geometry_from_file(args.aoi), args.output)
        print(json.dumps({"crop_ok": True, "output": str(args.output)}, ensure_ascii=False))
        return 0
    if args.command == "osm":
        artifacts = extract_osm_layers(item.osm, _geometry_from_file(args.aoi), args.output, item.osm_snapshot)
        print(json.dumps({
            "osm_ok": True,
            "artifacts": [{"type": item.artifact_type, "features": item.feature_count, "warning": item.warning_code} for item in artifacts],
        }, ensure_ascii=False))
        return 0
    artifact = generate_contours(
        item.dem,
        _geometry_from_file(args.aoi),
        args.output,
        args.interval,
        args.smoothing,
        item.dem_source,
    )
    print(json.dumps({
        "contours_ok": True,
        "features": artifact.feature_count,
        "warning": artifact.warning_code,
        "source": json.loads(artifact.source),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
