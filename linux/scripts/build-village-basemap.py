"""Convert a georeferenced RGB Web Mercator GeoTIFF to bounded XYZ WebP tiles."""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds
from rasterio.windows import Window


HALF_WORLD = math.pi * 6378137
TILE = 256


def build(source, output, minimum, maximum):
    with rasterio.open(source) as image:
        if image.crs != rasterio.crs.CRS.from_epsg(3857) or image.count != 3 or image.dtypes[0] != "uint8":
            raise ValueError("Expected a three-band RGB Byte raster in EPSG:3857")
        output.mkdir(parents=True, exist_ok=False)
        bounds = transform_bounds(image.crs, "EPSG:4326", *image.bounds)
        count = 0
        for zoom in range(minimum, maximum + 1):
            span = 2 * HALF_WORLD / (2 ** zoom)
            left = math.floor((image.bounds.left + HALF_WORLD) / span)
            top = math.floor((HALF_WORLD - image.bounds.top) / span)
            right = math.ceil((image.bounds.right + HALF_WORLD) / span)
            bottom = math.ceil((HALF_WORLD - image.bounds.bottom) / span)
            transform = from_origin(-HALF_WORLD + left * span, HALF_WORLD - top * span,
                                    span / TILE, span / TILE)
            # The downloader fills pixels outside its selection with RGB black.
            with WarpedVRT(image, transform=transform, width=(right - left) * TILE,
                           height=(bottom - top) * TILE, add_alpha=True, src_nodata=0,
                           resampling=Resampling.average) as vrt:
                for x in range(left, right):
                    folder = output / str(zoom) / str(x)
                    folder.mkdir(parents=True)
                    for y in range(top, bottom):
                        data = vrt.read(window=Window((x-left)*TILE, (y-top)*TILE, TILE, TILE))
                        Image.fromarray(np.moveaxis(data, 0, -1), "RGBA").save(
                            folder / f"{y}.webp", quality=86, method=3)
                        count += 1
            print(f"z{zoom}: {count} cumulative tiles", flush=True)
        (output / "metadata.json").write_text(json.dumps({
            "bounds": bounds, "minZoom": minimum, "maxZoom": maximum, "tileCount": count
        }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output, 14, 21)
