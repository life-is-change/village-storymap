import types
import unittest


from run_profile import apply_profile


class ApplyProfileTests(unittest.TestCase):
    def setUp(self):
        self.module = types.SimpleNamespace(
            MIN_INSTANCE_PIXELS=150,
            MAX_ASPECT_RATIO=8.0,
            MIN_RECT_FILL_RATIO=0.45,
            _is_in_center=lambda mask: False,
        )

    def test_source_like_profile_prioritizes_recall(self):
        tile_size, overlap = apply_profile(self.module, "source_like")

        self.assertEqual((tile_size, overlap), (512, 128))
        self.assertEqual(self.module.MIN_INSTANCE_PIXELS, 25)
        self.assertEqual(self.module.MAX_ASPECT_RATIO, float("inf"))
        self.assertEqual(self.module.MIN_RECT_FILL_RATIO, 0.0)
        self.assertTrue(self.module._is_in_center(object()))

    def test_strict_profile_preserves_current_linux_defaults(self):
        tile_size, overlap = apply_profile(self.module, "strict")

        self.assertEqual((tile_size, overlap), (1536, 384))
        self.assertEqual(self.module.MIN_INSTANCE_PIXELS, 150)
        self.assertEqual(self.module.MAX_ASPECT_RATIO, 8.0)
        self.assertEqual(self.module.MIN_RECT_FILL_RATIO, 0.45)
        self.assertFalse(self.module._is_in_center(object()))

    def test_balanced_profile_relaxes_filters_and_keeps_edges(self):
        tile_size, overlap = apply_profile(self.module, "balanced")

        self.assertEqual((tile_size, overlap), (1024, 256))
        self.assertEqual(self.module.MIN_INSTANCE_PIXELS, 60)
        self.assertEqual(self.module.MAX_ASPECT_RATIO, 12.0)
        self.assertEqual(self.module.MIN_RECT_FILL_RATIO, 0.30)
        self.assertTrue(self.module._is_in_center(object()))


if __name__ == "__main__":
    unittest.main()
