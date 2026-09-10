import os
from pathlib import Path
import subprocess
import tempfile


def _print_results(results: dict[str, bool]) -> int:
    for code, okay in results.items():
        print(f"{code}={'OK' if okay else 'FAIL'}")
    return 0 if all(results.values()) else 1


def _directory_is_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path, prefix=".health-", delete=True):
            pass
        return True
    except OSError:
        return False


def run_facade_health_checks(
    *, client=None, subprocess_run=subprocess.run, http_get=None
) -> int:
    """Validate every facade dependency before the worker can claim a run."""
    results: dict[str, bool] = {}
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    results["SUPABASE_URL"] = url.startswith("https://")
    results["SUPABASE_KEY"] = bool(key)

    blender = Path(os.environ.get("BLENDER_EXECUTABLE", "/usr/bin/blender"))
    try:
        completed = subprocess_run(
            [str(blender), "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        version_output = f"{completed.stdout}\n{completed.stderr}"
        results["BLENDER_3_0_1"] = (
            blender.is_file()
            and completed.returncode == 0
            and "Blender 3.0.1" in version_output
        )
    except (OSError, subprocess.SubprocessError):
        results["BLENDER_3_0_1"] = False

    work_root = Path(os.environ.get("FACADE_WORK_ROOT", "/work"))
    model_root = Path(os.environ.get("FACADE_MODEL_ROOT", "/models"))
    build_seg_root = Path(os.environ.get("BUILD_SEG_ROOT", model_root / "building-seg"))
    checkpoint = Path(
        os.environ.get(
            "SAM2_CHECKPOINT",
            build_seg_root / "checkpoints" / "sam2.1_hiera_large.pt",
        )
    )
    results["FACADE_WORK_ROOT"] = _directory_is_writable(work_root)
    results["FACADE_MODEL_ROOT"] = model_root.is_dir()
    results["SAM2_REPOSITORY"] = (build_seg_root / "repos" / "sam2").is_dir()
    results["SAM2_CHECKPOINT"] = checkpoint.is_file()

    if http_get is None:
        import httpx

        http_get = httpx.get
    service_urls = {
        "FACADE_ML": os.environ.get(
            "RURAL_FACADE_ML_URL",
            os.environ.get("FACADE_ML_URL", "http://127.0.0.1:8012"),
        ),
        "FACADE_LAMA": os.environ.get(
            "RURAL_LAMA_URL",
            os.environ.get("FACADE_LAMA_URL", "http://127.0.0.1:8013"),
        ),
    }
    for code, base_url in service_urls.items():
        try:
            response = http_get(f"{base_url.rstrip('/')}/health", timeout=5)
            results[code] = response.status_code == 200
        except Exception:
            results[code] = False

    try:
        if client is None:
            from supabase import create_client

            client = create_client(url, key)
        for bucket in ("facade-generation", "house-photos"):
            client.storage.get_bucket(bucket)
        results["FACADE_STORAGE"] = True
    except Exception:
        results["FACADE_STORAGE"] = False

    return _print_results(results)


def run_health_checks(check_remote: bool = False) -> int:
    results: dict[str, bool] = {}
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    data_root_value = os.environ.get("PLATFORM_DATA_ROOT", "")
    work_root_value = os.environ.get("PLATFORM_WORK_ROOT", "server/runtime")
    catalog_value = os.environ.get("PLATFORM_CATALOG", "server/config/villages.yaml")
    results["SUPABASE_URL"] = url.startswith("https://")
    results["SUPABASE_KEY"] = bool(key)
    data_root = Path(data_root_value) if data_root_value else None
    results["DATA_ROOT"] = bool(data_root and data_root.is_dir())
    work_root = Path(work_root_value)
    results["WORK_ROOT"] = work_root.is_dir() or work_root.parent.is_dir()
    catalog_path = Path(catalog_value)
    results["CATALOG"] = catalog_path.is_file()
    try:
        from osgeo import gdal, ogr
        import geopandas  # noqa: F401
        import rasterio  # noqa: F401

        results["GIS_RUNTIME"] = bool(gdal.VersionInfo() and ogr.GetDriverByName("OSM"))
    except Exception:
        results["GIS_RUNTIME"] = False
    if results["DATA_ROOT"] and results["CATALOG"]:
        try:
            from .catalog import load_catalog

            load_catalog(catalog_path, data_root).resolve("mibu")
            results["DATASETS"] = True
        except Exception:
            results["DATASETS"] = False
    else:
        results["DATASETS"] = False
    if check_remote:
        try:
            import httpx

            building_url = os.environ.get("BUILDING_SERVICE_URL", "http://127.0.0.1:8021")
            results["BUILDING_SERVICE"] = httpx.get(f"{building_url}/health", timeout=5).status_code == 200
        except Exception:
            results["BUILDING_SERVICE"] = False
        try:
            from supabase import create_client

            client = create_client(url, key)
            client.storage.get_bucket("geoprocessing-results")
            results["SUPABASE_STORAGE"] = True
        except Exception:
            results["SUPABASE_STORAGE"] = False
    return _print_results(results)
