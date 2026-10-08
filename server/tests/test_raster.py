from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds

from village_processing.raster import crop_imagery


def test_crop_imagery_writes_three_band_georeferenced_tiff(tmp_path: Path):
    source = tmp_path / "source.tif"
    output = tmp_path / "crop.tif"
    transform = from_bounds(113.65, 23.67, 113.67, 23.69, 200, 200)
    data = np.arange(4 * 200 * 200, dtype=np.uint16).reshape(4, 200, 200)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=4,
        dtype=data.dtype,
        crs="EPSG:4326",
        transform=transform,
    ) as dataset:
        dataset.write(data)
    aoi = {
        "type": "Polygon",
        "coordinates": [[[113.659, 23.679], [113.661, 23.679], [113.661, 23.681], [113.659, 23.681], [113.659, 23.679]]],
    }

    crop_imagery(source, aoi, output)

    with rasterio.open(output) as cropped:
        assert cropped.count == 3
        assert cropped.crs.to_epsg() == 4326
        assert 0 < cropped.width < 200
        assert 0 < cropped.height < 200
        assert cropped.compression.value.lower() == "deflate"
