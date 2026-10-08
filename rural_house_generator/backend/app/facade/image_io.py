from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray


def read_image(path: Path) -> NDArray[np.uint8] | None:
    try:
        encoded = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        return None
    if encoded.size == 0:
        return None
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def write_image(
    path: Path,
    image: NDArray[np.uint8],
    extension: str,
    parameters: list[int] | None = None,
) -> bool:
    success, encoded = cv2.imencode(extension, image, parameters or [])
    if not success:
        return False
    try:
        encoded.tofile(str(path))
    except OSError:
        return False
    return True
