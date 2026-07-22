from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.transform import from_bounds

from village_processing.processors.contours import generate_contours, masked_gaussian


def test_masked_gaussian_does_not_bleed_nodata():
    data = np.array([[0, 0, 0], [0, 100, 110], [0, 120, 130]], dtype="float32")
    valid = data != 0

    output = masked_gaussian(data, valid, sigma=1)

    assert np.isnan(output[0, 0])
    assert output[1, 1] > 90


def test_contours_are_interval_multiples(tmp_path: Path):
    dem = tmp_path / "dem.tif"
    output = tmp_path / "contours.geojson"
    rows, columns = np.mgrid[0:100, 0:100]
    elevation = (40 + rows * 0.8 + columns * 0.2).astype("float32")
    with rasterio.open(
        dem,
        "w",
        driver="GTiff",
        width=100,
        height=100,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_bounds(113.64, 23.66, 113.68, 23.70, 100, 100),
        nodata=-9999,
    ) as dataset:
        dataset.write(elevation, 1)
    aoi = {
        "type": "Polygon",
        "coordinates": [[[113.65, 23.67], [113.67, 23.67], [113.67, 23.69], [113.65, 23.69], [113.65, 23.67]]],
    }

    summary = generate_contours(dem, aoi, output, interval_m=5, smoothing_sigma=1)
    frame = gpd.read_file(summary.path)

    assert len(frame) > 0
    assert all((frame.elevation_m % 5) == 0)
    assert frame.crs.to_epsg() == 4326
