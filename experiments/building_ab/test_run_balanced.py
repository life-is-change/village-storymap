import types
import unittest

import numpy as np


from run_balanced import (
    configure_balanced_module,
    configure_compatible_image_reader,
    configure_source_like_module,
    configure_strict_module,
)


class ConfigureBalancedModuleTests(unittest.TestCase):
    def test_source_like_profile_matches_original_detection_sensitivity(self):
        module = types.SimpleNamespace(
            TILE_SIZE=1536,
            TILE_OVERLAP=384,
            MIN_INSTANCE_PIXELS=150,
            MAX_ASPECT_RATIO=8.0,
            MIN_RECT_FILL_RATIO=0.45,
            BATCH_SIZE=2,
            is_in_center_region=lambda mask, edge_ignore=96: False,
        )

        configure_source_like_module(module)

        self.assertEqual(module.TILE_SIZE, 512)
        self.assertEqual(module.TILE_OVERLAP, 128)
        self.assertEqual(module.MIN_INSTANCE_PIXELS, 25)
        self.assertEqual(module.MAX_ASPECT_RATIO, float("inf"))
        self.assertEqual(module.MIN_RECT_FILL_RATIO, 0.0)
        self.assertTrue(module.is_in_center_region(object()))

    def test_compatible_reader_returns_gdal_style_band_first_rgb(self):
        dataset = types.SimpleNamespace(marker="dataset")
        bgr = np.array([[[1, 2, 3], [4, 5, 6]]], dtype=np.uint8)
        module = types.SimpleNamespace(
            gdal=types.SimpleNamespace(Open=lambda path, *args, **kwargs: dataset),
            cv_imread=lambda path: bgr,
            np=np,
        )

        configure_compatible_image_reader(module)
        opened = module.gdal.Open("image.tif")
        array = opened.ReadAsArray()

        self.assertEqual(opened.marker, "dataset")
        self.assertEqual(array.shape, (3, 1, 2))
        self.assertEqual(array[:, 0, 0].tolist(), [3, 2, 1])

    def test_strict_profile_uses_stable_single_image_inference(self):
        module = types.SimpleNamespace(BATCH_SIZE=2)

        configure_strict_module(module)

        self.assertEqual(module.BATCH_SIZE, 1)

    def test_applies_balanced_detection_parameters(self):
        module = types.SimpleNamespace(
            TILE_SIZE=1536,
            TILE_OVERLAP=384,
            MIN_INSTANCE_PIXELS=150,
            MAX_ASPECT_RATIO=8.0,
            MIN_RECT_FILL_RATIO=0.45,
            BATCH_SIZE=2,
            is_in_center_region=lambda mask, edge_ignore=96: False,
        )

        configure_balanced_module(module)

        self.assertEqual(module.TILE_SIZE, 1024)
        self.assertEqual(module.TILE_OVERLAP, 256)
        self.assertEqual(module.MIN_INSTANCE_PIXELS, 60)
        self.assertEqual(module.MAX_ASPECT_RATIO, 12.0)
        self.assertEqual(module.MIN_RECT_FILL_RATIO, 0.30)
        self.assertEqual(module.BATCH_SIZE, 1)

    def test_preserves_masks_at_the_outer_image_edge(self):
        module = types.SimpleNamespace(
            TILE_SIZE=1536,
            TILE_OVERLAP=384,
            MIN_INSTANCE_PIXELS=150,
            MAX_ASPECT_RATIO=8.0,
            MIN_RECT_FILL_RATIO=0.45,
            BATCH_SIZE=2,
            is_in_center_region=lambda mask, edge_ignore=96: False,
        )

        configure_balanced_module(module)

        self.assertTrue(module.is_in_center_region(object()))


if __name__ == "__main__":
    unittest.main()
