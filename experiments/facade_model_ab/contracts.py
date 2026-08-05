from __future__ import annotations

from dataclasses import dataclass, field
from collections.abc import Callable
from typing import Any

import numpy as np


class ModelUnavailable(RuntimeError):
    """Raised only when an optional model cannot serve an inference request."""


@dataclass(frozen=True)
class ModelAvailability:
    available: bool
    reason_code: str
    detail: str


@dataclass(frozen=True)
class CalibrationResult:
    image: np.ndarray
    source_to_working: np.ndarray
    source_point_mapper: Callable[[np.ndarray], np.ndarray] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    coordinate_space: str = "working_pixels"


@dataclass(frozen=True)
class LineDetectionResult:
    segments: np.ndarray
    scores: np.ndarray
    metadata: dict[str, Any] = field(default_factory=dict)
    coordinate_space: str = "normalized_source"
