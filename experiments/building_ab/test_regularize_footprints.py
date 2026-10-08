import math
import unittest

from regularize_footprints import (
    regularize_feature_collection,
    regularize_local_ring,
    regularize_wgs84_ring,
)


def rotate(points, degrees):
    angle = math.radians(degrees)
    cosine, sine = math.cos(angle), math.sin(angle)
    return [
        (x * cosine - y * sine, x * sine + y * cosine)
        for x, y in points
    ]


class RegularizeLocalRingTests(unittest.TestCase):
    def test_rotated_rectangle_becomes_four_vertex_rectangle(self):
        ring = rotate([(0, 0), (10, 0), (10, 4), (0, 4), (0, 0)], 27)

        result = regularize_local_ring(ring)

        self.assertEqual("rectangle", result.method)
        self.assertEqual(4, result.vertex_count)
        self.assertLess(result.area_change_ratio, 0.05)

    def test_general_quadrilateral_remains_four_vertices(self):
        ring = [(0, 0), (9, 1), (7, 5), (1, 4), (0, 0)]

        result = regularize_local_ring(ring)

        self.assertEqual("quadrilateral", result.method)
        self.assertEqual(4, result.vertex_count)

    def test_l_shape_remains_six_edge_orthogonal_polygon(self):
        ring = [(0, 0), (8, 0), (8, 3), (3, 3), (3, 8), (0, 8), (0, 0)]

        result = regularize_local_ring(ring)

        self.assertEqual("orthogonal_complex", result.method)
        self.assertEqual(6, result.vertex_count)
        self.assertLess(result.area_change_ratio, 0.05)

    def test_t_shape_remains_at_most_eight_edges(self):
        ring = [
            (0, 0), (8, 0), (8, 3), (5, 3),
            (5, 9), (3, 9), (3, 3), (0, 3), (0, 0),
        ]

        result = regularize_local_ring(ring)

        self.assertEqual("orthogonal_complex", result.method)
        self.assertEqual(8, result.vertex_count)

    def test_noisy_rectangle_does_not_keep_curved_looking_edge(self):
        ring = [
            (0, 0), (2, -0.1), (4, 0.1), (6, -0.1), (8, 0),
            (8.1, 2), (8, 4), (6, 4.1), (4, 3.9), (2, 4.1),
            (0, 4), (-0.1, 2), (0, 0),
        ]

        result = regularize_local_ring(ring)

        self.assertEqual("rectangle", result.method)
        self.assertEqual(4, result.vertex_count)

    def test_self_intersecting_ring_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "SELF_INTERSECTING_RING"):
            regularize_local_ring([(0, 0), (4, 4), (0, 4), (4, 0), (0, 0)])

    def test_wgs84_l_shape_keeps_six_vertices(self):
        lon, lat = 113.10, 23.20
        scale = 0.00001
        ring = [
            [lon + x * scale, lat + y * scale]
            for x, y in [(0, 0), (8, 0), (8, 3), (3, 3), (3, 8), (0, 8), (0, 0)]
        ]

        result = regularize_wgs84_ring(ring)

        self.assertEqual(6, result.vertex_count)
        self.assertEqual(result.ring[0], result.ring[-1])

    def test_feature_collection_preserves_count_and_adds_diagnostics(self):
        payload = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"score": 0.9},
                "geometry": {"type": "Polygon", "coordinates": [[
                    [113.0, 23.0], [113.0001, 23.0],
                    [113.0001, 23.00004], [113.0, 23.00004], [113.0, 23.0],
                ]]},
            }],
        }

        output, stats = regularize_feature_collection(payload)

        self.assertEqual(1, len(output["features"]))
        properties = output["features"][0]["properties"]
        self.assertEqual(4, properties["regularized_vertex_count"])
        self.assertEqual(1, stats["methods"]["rectangle"])


if __name__ == "__main__":
    unittest.main()
