from __future__ import annotations

import numpy as np

from rural_house_generator.backend.app.facade.auto_rectify import _select_boundary, detect_facade_quad


def test_boundary_selection_keeps_the_outer_roof_before_longer_inner_balcony():
    lines = np.float32([
        [[50, 20], [250, 20]],
        [[20, 80], [320, 80]],
        [[40, 170], [300, 170]],
    ])

    selected = _select_boundary(lines, axis=1, side="low", size=200)

    assert selected.mean(axis=0)[1] == 20


def test_detector_retries_with_shorter_central_verticals(monkeypatch):
    strict_lines = np.float32([
        [[220, 100, 980, 100]],
        [[220, 500, 980, 500]],
    ])
    relaxed_lines = np.float32([
        [[220, 100, 980, 100]],
        [[220, 500, 980, 500]],
        [[220, 100, 220, 500]],
        [[980, 100, 980, 500]],
        [[20, 0, 20, 599]],
        [[1180, 0, 1180, 599]],
    ])
    calls = iter([strict_lines, relaxed_lines])
    monkeypatch.setattr('cv2.HoughLinesP', lambda *args, **kwargs: next(calls))

    quad, diagnostics = detect_facade_quad(np.full((600, 1200, 3), 180, np.uint8))

    assert diagnostics['detector_pass'] == 'relaxed'
    assert np.allclose(quad, [[220, 100], [980, 100], [980, 500], [220, 500]])
