from hashlib import sha256
import json
import math
from pathlib import Path
import tempfile

import geopandas as gpd
import numpy as np
from osgeo import gdal, ogr, osr
from pyproj import CRS, Transformer
from scipy.ndimage import gaussian_filter
from shapely.geometry import mapping, shape
from shapely.ops import transform

from village_processing.contracts import ArtifactSummary


NODATA = -9999.0


def masked_gaussian(data: np.ndarray, valid: np.ndarray, sigma: int) -> np.ndarray:
    if sigma == 0:
        return np.where(valid, data, np.nan)
    weights = gaussian_filter(valid.astype("float32"), sigma=sigma)
    values = gaussian_filter(np.where(valid, data, 0).astype("float32"), sigma=sigma)
    return np.where(valid & (weights > 0), values / np.maximum(weights, 1e-6), np.nan)


def _utm_crs(geometry) -> CRS:
    centroid = geometry.centroid
    zone = int((centroid.x + 180) // 6) + 1
    return CRS.from_epsg((32700 if centroid.y < 0 else 32600) + zone)


def _write_smoothed_raster(path: Path, array: np.ndarray, source) -> None:
    driver = gdal.GetDriverByName("GTiff")
    target = driver.Create(
        str(path), source.RasterXSize, source.RasterYSize, 1, gdal.GDT_Float32,
        options=["TILED=YES", "COMPRESS=DEFLATE", "BLOCKXSIZE=256", "BLOCKYSIZE=256"],
    )
    target.SetGeoTransform(source.GetGeoTransform())
    target.SetProjection(source.GetProjection())
    band = target.GetRasterBand(1)
    band.SetNoDataValue(NODATA)
    band.WriteArray(np.where(np.isfinite(array), array, NODATA).astype("float32"))
    band.FlushCache()
    target.FlushCache()
    target = None


def _empty_output(path: Path) -> None:
    path.write_text(json.dumps({"type": "FeatureCollection", "features": []}), "utf-8")


def generate_contours(
    dem_path: Path,
    aoi: dict,
    output_geojson: Path,
    interval_m: int,
    smoothing_sigma: int,
    dem_source: str = "Copernicus DEM GLO-30",
) -> ArtifactSummary:
    if interval_m not in {5, 10}:
        raise ValueError("INVALID_CONTOUR_INTERVAL")
    if smoothing_sigma not in {0, 1}:
        raise ValueError("INVALID_CONTOUR_SMOOTHING")
    geometry = shape(aoi)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError("INVALID_AOI")
    utm = _utm_crs(geometry)
    to_utm = Transformer.from_crs(4326, utm, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(utm, 4326, always_xy=True).transform
    aoi_metric = transform(to_utm, geometry)
    buffered_metric = aoi_metric.buffer(300)
    buffered_wgs84 = transform(to_wgs84, buffered_metric)
    output_geojson = Path(output_geojson)
    output_geojson.parent.mkdir(parents=True, exist_ok=True)
    gdal.UseExceptions()

    with tempfile.TemporaryDirectory(prefix="village-contours-") as temporary:
        temporary = Path(temporary)
        cutline = temporary / "buffer.geojson"
        cutline.write_text(json.dumps({
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {}, "geometry": mapping(buffered_wgs84)}],
        }), "utf-8")
        warped_path = temporary / "dem_utm.tif"
        bounds = buffered_metric.bounds
        warped = gdal.Warp(
            str(warped_path),
            str(dem_path),
            format="GTiff",
            dstSRS=utm.to_wkt(),
            outputBounds=bounds,
            outputBoundsSRS=utm.to_wkt(),
            xRes=30,
            yRes=30,
            resampleAlg="bilinear",
            srcNodata=0,
            dstNodata=NODATA,
            cutlineDSName=str(cutline),
            cropToCutline=True,
            multithread=True,
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE"],
        )
        if warped is None:
            raise RuntimeError("DEM_WARP_FAILED")
        data = warped.GetRasterBand(1).ReadAsArray().astype("float32")
        valid = np.isfinite(data) & (data != NODATA)
        valid_ratio = float(valid.mean())
        if valid_ratio < 0.6:
            raise ValueError("DEM_INSUFFICIENT_VALID_DATA")
        smoothed = masked_gaussian(data, valid, smoothing_sigma)
        smoothed_path = temporary / "dem_smoothed.tif"
        _write_smoothed_raster(smoothed_path, smoothed, warped)
        warped = None

        contour_path = temporary / "contours.gpkg"
        vector_driver = ogr.GetDriverByName("GPKG")
        vector = vector_driver.CreateDataSource(str(contour_path))
        spatial_ref = osr.SpatialReference()
        spatial_ref.ImportFromWkt(utm.to_wkt())
        layer = vector.CreateLayer("contours", spatial_ref, ogr.wkbLineString)
        layer.CreateField(ogr.FieldDefn("id", ogr.OFTInteger))
        layer.CreateField(ogr.FieldDefn("elevation_m", ogr.OFTReal))
        smoothed_ds = gdal.Open(str(smoothed_path))
        minimum = float(np.nanmin(smoothed))
        base = math.floor(minimum / interval_m) * interval_m
        try:
            gdal.ContourGenerateEx(
                smoothed_ds.GetRasterBand(1),
                layer,
                options=[
                    f"LEVEL_INTERVAL={interval_m}",
                    f"LEVEL_BASE={base}",
                    f"NODATA={NODATA}",
                    "ID_FIELD=0",
                    "ELEV_FIELD=1",
                ],
            )
        finally:
            layer = None
            vector = None
            smoothed_ds = None

        frame = gpd.read_file(contour_path, layer="contours")
        if len(frame):
            clipped = gpd.clip(frame, gpd.GeoDataFrame(geometry=[aoi_metric], crs=utm))
            clipped = clipped[clipped.geometry.notna() & ~clipped.geometry.is_empty].copy()
            if len(clipped):
                clipped.geometry = clipped.geometry.simplify(2, preserve_topology=True)
                clipped = clipped.to_crs(4326)
                clipped["source"] = "dem_contour"
                clipped["dem_source"] = dem_source
                clipped.to_file(output_geojson, driver="GeoJSON")
                count = len(clipped)
                bbox = tuple(float(value) for value in clipped.total_bounds)
            else:
                _empty_output(output_geojson)
                count, bbox = 0, (0.0, 0.0, 0.0, 0.0)
        else:
            _empty_output(output_geojson)
            count, bbox = 0, (0.0, 0.0, 0.0, 0.0)

    metadata = {
        "type": "dem_contour",
        "dem_source": dem_source,
        "utm_epsg": utm.to_epsg(),
        "interval_m": interval_m,
        "smoothing_sigma": smoothing_sigma,
        "valid_ratio": round(valid_ratio, 6),
        "resolution_m": 30,
        "simplify_m": 2,
    }
    return ArtifactSummary(
        path=output_geojson,
        artifact_type="contours",
        feature_count=count,
        bbox=bbox,
        sha256=sha256(output_geojson.read_bytes()).hexdigest(),
        source=json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
        warning_code="CONTOUR_LAYER_EMPTY" if count == 0 else None,
    )
