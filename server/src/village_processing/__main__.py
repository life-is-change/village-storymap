import argparse
import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from .catalog import load_catalog
from .raster import crop_imagery
from .processors.osm import extract_osm_layers
from .processors.contours import generate_contours
from .contracts import ProcessingRequest
from .pipeline import NativeProcessors, resolve_run_request, run_pipeline


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
    health = subparsers.add_parser("health")
    health.add_argument("--local", action="store_true")
    subparsers.add_parser("worker")
    return parser


def main(argv=None) -> int:
    server_root = Path(__file__).resolve().parents[2]
    load_dotenv(server_root / ".env")
    args = build_parser().parse_args(argv)
    if args.command == "health":
        from .health import run_health_checks

        return run_health_checks(check_remote=not args.local)
    data_root = os.environ.get("PLATFORM_DATA_ROOT")
    if not data_root:
        raise SystemExit("PLATFORM_DATA_ROOT is required")
    if args.command == "worker":
        from supabase import create_client
        from .queue.gateway import SupabaseGateway
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
        pipeline_runner = lambda queued: run_pipeline(
            queued.processing_request(work_root), catalog, processors
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
