from pathlib import Path

from pyproj import CRS, Transformer
import rasterio
from rasterio.mask import mask
from shapely.geometry import shape, mapping
from shapely.ops import transform


def _buffer_wgs84_meters(geometry: dict, distance: float):
    geom = shape(geometry)
    centroid = geom.centroid
    zone = int((centroid.x + 180) // 6) + 1
    utm = CRS.from_dict({"proj": "utm", "zone": zone, "south": centroid.y < 0})
    to_utm = Transformer.from_crs("EPSG:4326", utm, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(utm, "EPSG:4326", always_xy=True).transform
    return transform(to_wgs84, transform(to_utm, geom).buffer(distance))


def crop_imagery(source_tif: Path, aoi: dict, output_tif: Path, buffer_meters: float = 50) -> Path:
    buffered = _buffer_wgs84_meters(aoi, buffer_meters)
    output_tif = Path(output_tif)
    output_tif.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(source_tif) as source:
        if source.count < 3 or source.crs is None:
            raise ValueError("INVALID_SOURCE_IMAGERY")
        to_source = Transformer.from_crs("EPSG:4326", source.crs, always_xy=True).transform
        source_geometry = transform(to_source, buffered)
        data, output_transform = mask(source, [mapping(source_geometry)], crop=True, indexes=[1, 2, 3])
        profile = source.profile.copy()
        profile.update(
            driver="GTiff",
            width=data.shape[2],
            height=data.shape[1],
            count=3,
            transform=output_transform,
            compress="deflate",
            tiled=True,
            blockxsize=256,
            blockysize=256,
            BIGTIFF="IF_SAFER",
        )
        with rasterio.open(output_tif, "w", **profile) as output:
            output.write(data)
    return output_tif
