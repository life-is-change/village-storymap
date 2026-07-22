import os
from pathlib import Path


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
    for code, okay in results.items():
        print(f"{code}={'OK' if okay else 'FAIL'}")
    return 0 if all(results.values()) else 1
