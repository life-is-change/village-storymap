from __future__ import annotations

import cv2
import numpy as np

from experiments.facade_25d.orthographic import PlaneSpec, compose_planes, rectify_plane


def test_rectify_plane_maps_trapezoid_pixels_to_full_rectangle():
    image = np.full((200, 300, 3), 245, dtype=np.uint8)
    quad = np.float32([[50, 30], [250, 50], [230, 160], [70, 170]])
    cv2.fillConvexPoly(image, quad.astype(np.int32), (20, 80, 200))

    rectified = rectify_plane(image, quad, output_size=(240, 120))

    assert rectified.shape == (120, 240, 3)
    np.testing.assert_allclose(rectified[60, 120], np.array([20, 80, 200]), atol=2)


def test_compose_planes_keeps_photo_color_inside_destination_and_background_outside():
    image = np.full((200, 300, 3), 245, dtype=np.uint8)
    quad = np.float32([[50, 30], [250, 50], [230, 160], [70, 170]])
    cv2.fillConvexPoly(image, quad.astype(np.int32), (20, 80, 200))
    plane = PlaneSpec(
        name="front",
        source_quad=quad,
        destination_box=(0.10, 0.20, 0.90, 0.80),
    )

    result = compose_planes(
        image,
        (plane,),
        output_size=(400, 300),
        background=(232, 234, 236),
    )

    np.testing.assert_allclose(result[150, 200], np.array([20, 80, 200]), atol=2)
    np.testing.assert_array_equal(result[10, 10], np.array([232, 234, 236]))


def test_compose_planes_feathers_overlay_edge_without_changing_center():
    image = np.full((40, 60, 3), (20, 80, 200), dtype=np.uint8)
    plane = PlaneSpec(
        name="opening",
        source_quad=np.float32([[0, 0], [59, 0], [59, 39], [0, 39]]),
        destination_box=(0.20, 0.20, 0.80, 0.80),
        feather_px=4,
    )

    result = compose_planes(
        image,
        (plane,),
        output_size=(100, 100),
        background=(240, 240, 240),
    )

    np.testing.assert_allclose(result[50, 50], np.array([20, 80, 200]), atol=2)
    edge = result[20, 50]
    assert np.all(edge > np.array([20, 80, 200]))
    assert np.all(edge < np.array([240, 240, 240]))


def test_compose_planes_can_feather_only_the_top_seam():
    image = np.full((40, 60, 3), (20, 80, 200), dtype=np.uint8)
    plane = PlaneSpec(
        name="wall-band",
        source_quad=np.float32([[0, 0], [59, 0], [59, 39], [0, 39]]),
        destination_box=(0.20, 0.20, 0.80, 0.80),
        feather_px=4,
        feather_edges=("top",),
    )

    result = compose_planes(
        image,
        (plane,),
        output_size=(100, 100),
        background=(240, 240, 240),
    )

    top_edge = result[20, 50]
    assert np.all(top_edge > np.array([20, 80, 200]))
    assert np.all(top_edge < np.array([240, 240, 240]))
    np.testing.assert_allclose(result[50, 20], np.array([20, 80, 200]), atol=2)
