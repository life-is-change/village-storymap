from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from rural_house_generator.backend.app.main import create_app
from rural_house_generator.backend.app.facade.auto_rectify import RectificationResult


class PassThroughRectifier:
    def rectify(self, image: np.ndarray) -> RectificationResult:
        return RectificationResult(
            image=np.ascontiguousarray(image),
            diagnostics={"method": "test-pass-through", "resample_passes": 1},
        )


@pytest.fixture
def runtime_root(tmp_path: Path) -> Path:
    return tmp_path / "runtime"


@pytest.fixture
def client(runtime_root: Path) -> TestClient:
    with TestClient(
        create_app(runtime_root=runtime_root, facade_rectifier=PassThroughRectifier())
    ) as test_client:
        yield test_client


@pytest.fixture
def valid_job_form() -> dict[str, str]:
    return {
        "building_width": "8.0",
        "building_depth": "6.0",
        "wall_height": "6.0",
        "roof_height": "2.0",
        "roof_type": "gable",
        "roof_material": "asphalt_shingle",
        "roof_pitch": "low",
    }


@pytest.fixture
def perspective_facade() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return a reference facade, its perspective photo and pixel-space corners."""
    facade = np.full((200, 320, 3), 235, dtype=np.uint8)
    facade[:25, :] = (40, 80, 220)
    facade[-25:, :] = (60, 190, 80)
    facade[:, :25] = (220, 80, 50)
    facade[:, -25:] = (40, 200, 220)
    for x in range(40, 320, 40):
        cv2.line(facade, (x, 0), (x, 199), (30, 30, 30), 2)
    for y in range(40, 200, 40):
        cv2.line(facade, (0, y), (319, y), (30, 30, 30), 2)

    source = np.float32([[0, 0], [319, 0], [319, 199], [0, 199]])
    corners = np.float32([[50, 50], [370, 50], [400, 250], [80, 250]])
    transform = cv2.getPerspectiveTransform(source, corners)
    photo = cv2.warpPerspective(facade, transform, (450, 300))
    return facade, photo, corners
