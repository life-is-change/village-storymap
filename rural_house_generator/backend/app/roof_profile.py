from __future__ import annotations

import math


PITCH_DEGREES = {"low": 18.0, "standard": 26.0, "high": 34.0}
ROOF_TYPES = {"hip", "gable", "flat"}
MATERIAL_PALETTES = {
    "gray_tile": {
        "base_color": (0.22, 0.25, 0.27, 1.0),
        "accent_color": (0.055, 0.065, 0.075, 1.0),
        "tile_scale": (1.45, 0.90),
    },
    "asphalt_shingle": {
        "base_color": (0.20, 0.23, 0.25, 1.0),
        "accent_color": (0.11, 0.13, 0.15, 1.0),
        "tile_scale": (1.30, 0.80),
    },
    "terracotta_tile": {
        "base_color": (0.44, 0.16, 0.08, 1.0),
        "accent_color": (0.24, 0.07, 0.035, 1.0),
        "tile_scale": (1.30, 1.00),
    },
}


def should_add_downspouts(
    roof_analysis: dict[str, object] | None,
) -> bool:
    if not isinstance(roof_analysis, dict):
        return False
    features = roof_analysis.get("detected_features")
    if not isinstance(features, list):
        return False
    return any(
        isinstance(feature, str) and feature.strip().lower() == "downspout"
        for feature in features
    )


def bounded_segment_count(
    length: float,
    nominal_size: float,
    maximum: int,
) -> int:
    if float(length) <= 0 or float(nominal_size) <= 0 or int(maximum) <= 0:
        raise ValueError("segment length, size and maximum must be positive")
    return max(
        1,
        min(
            int(maximum),
            int(math.ceil(float(length) / float(nominal_size))),
        ),
    )


def resolve_roof_profile(
    width: float,
    depth: float,
    wall_height: float,
    roof_type: str,
    roof_pitch: str = "standard",
    roof_material: str = "gray_tile",
) -> dict[str, object]:
    dimensions = (float(width), float(depth), float(wall_height))
    if any(value <= 0 for value in dimensions):
        raise ValueError("building dimensions must be positive")
    if roof_type not in ROOF_TYPES:
        raise ValueError(f"unsupported roof type: {roof_type}")
    if roof_pitch not in PITCH_DEGREES:
        raise ValueError(f"unsupported roof pitch: {roof_pitch}")
    if roof_material not in MATERIAL_PALETTES:
        raise ValueError(f"unsupported roof material: {roof_material}")

    width_value, depth_value, _ = dimensions
    ridge_axis = "x" if width_value >= depth_value else "y"
    span = depth_value if ridge_axis == "x" else width_value
    pitch_degrees = PITCH_DEGREES[roof_pitch]
    pitched_height = span * 0.5 * math.tan(math.radians(pitch_degrees))
    height = 0.18 if roof_type == "flat" else max(0.35, min(8.0, pitched_height))
    eave = max(0.25, min(0.60, min(width_value, depth_value) * 0.055))
    palette = MATERIAL_PALETTES[roof_material]

    return {
        "type": roof_type,
        "material": roof_material,
        "pitch": roof_pitch,
        "pitch_degrees": pitch_degrees,
        "ridge_axis": ridge_axis,
        "height": height,
        "eave": eave,
        "surface_thickness": 0.12,
        "pitched_details": roof_type != "flat",
        "soffit_thickness": 0.12,
        "drip_edge_height": 0.08,
        "eave_tile_width": 0.32,
        "eave_tile_rise": 0.055,
        "ridge_cap_length": 0.42,
        "ridge_cap_overlap": 0.07,
        "fascia_height": 0.22,
        "ridge_radius": 0.11,
        "gutter_radius": 0.075,
        "downspout_radius": 0.055,
        "downspout_offset": 0.18,
        "max_eave_tiles": 160,
        "max_ridge_caps": 96,
        "parapet_height": 0.60,
        "coping_width": 0.22,
        "tile_scale": palette["tile_scale"],
        "base_color": palette["base_color"],
        "accent_color": palette["accent_color"],
    }
