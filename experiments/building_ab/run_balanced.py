"""Run the existing strict desktop pipeline with a balanced experiment profile."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


STRICT_SCRIPT = Path(r"E:\村规平台学生体验版\建筑矢量\遥感影像农房矢量化正则化.py")


def configure_compatible_image_reader(module) -> None:
    original_open = module.gdal.Open
    cv_imread = module.cv_imread
    np = module.np

    class DatasetProxy:
        def __init__(self, dataset, path):
            self._dataset = dataset
            self._path = path

        def __getattr__(self, name):
            return getattr(self._dataset, name)

        def ReadAsArray(self, *args, **kwargs):
            image = cv_imread(self._path)
            if image is None:
                return None
            if image.ndim == 2:
                return image
            # OpenCV decodes BGR; GDAL's band-first array is RGB.
            rgb = image[:, :, :3][:, :, ::-1]
            return np.transpose(rgb, (2, 0, 1))

    def compatible_open(path, *args, **kwargs):
        dataset = original_open(path, *args, **kwargs)
        if dataset is None:
            return None
        return DatasetProxy(dataset, path)

    module.gdal.Open = compatible_open


def configure_strict_module(module) -> None:
    # MMDetection's Windows batch path crashes in this environment for lists
    # larger than one. Batch size does not change per-image model semantics.
    module.BATCH_SIZE = 1


def configure_source_like_module(module) -> None:
    configure_strict_module(module)
    module.TILE_SIZE = 512
    module.TILE_OVERLAP = 128
    module.MIN_INSTANCE_PIXELS = 25
    module.MAX_ASPECT_RATIO = float("inf")
    module.MIN_RECT_FILL_RATIO = 0.0
    module.is_in_center_region = lambda mask, edge_ignore=0: True


def configure_balanced_module(module) -> None:
    configure_strict_module(module)
    module.TILE_SIZE = 1024
    module.TILE_OVERLAP = 256
    module.MIN_INSTANCE_PIXELS = 60
    module.MAX_ASPECT_RATIO = 12.0
    module.MIN_RECT_FILL_RATIO = 0.30
    # The original edge rule cannot distinguish an internal tile seam from
    # the outer border of the full image. Keep edge detections here and let
    # the downstream spatial de-duplication remove overlap duplicates.
    module.is_in_center_region = lambda mask, edge_ignore=0: True


def load_strict_module(path: Path = STRICT_SCRIPT):
    spec = importlib.util.spec_from_file_location("building_strict_experiment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load strict pipeline: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    module = load_strict_module()
    configure_compatible_image_reader(module)
    configure_balanced_module(module)
    module.main()


if __name__ == "__main__":
    main()
