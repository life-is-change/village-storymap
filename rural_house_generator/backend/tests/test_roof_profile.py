from __future__ import annotations

import math

import pytest

from rural_house_generator.backend.app.roof_profile import (
    bounded_segment_count,
    resolve_roof_profile,
    should_add_downspouts,
)


def test_pitched_roof_height_uses_short_span_and_selected_pitch() -> None:
    profile = resolve_roof_profile(
        10.0, 6.0, 5.0, "hip", "standard", "gray_tile"
    )

    assert profile["ridge_axis"] == "x"
    assert profile["pitch_degrees"] == 26.0
    assert profile["height"] == pytest.approx(
        3.0 * math.tan(math.radians(26.0)), rel=1e-6
    )
    assert 0.25 <= profile["eave"] <= 0.60
    assert profile["surface_thickness"] == pytest.approx(0.12)


def test_roof_profile_rotates_ridge_and_distinguishes_pitch_and_material() -> None:
    assert resolve_roof_profile(6, 10, 5, "hip")["ridge_axis"] == "y"

    standard = resolve_roof_profile(10, 6, 5, "gable", "standard")
    high = resolve_roof_profile(10, 6, 5, "gable", "high")
    terracotta = resolve_roof_profile(
        10, 6, 5, "hip", roof_material="terracotta_tile"
    )

    assert high["height"] > standard["height"]
    assert terracotta["base_color"] != standard["base_color"]
    assert terracotta["tile_scale"] != standard["tile_scale"]


def test_roof_texture_atlas_repeats_at_a_visible_architectural_scale() -> None:
    profile = resolve_roof_profile(10, 6, 5, "hip", "standard", "gray_tile")

    atlas_width, atlas_height = profile["tile_scale"]
    assert atlas_width >= 1.0
    assert atlas_height >= 0.7


def test_detailed_roof_profile_has_bounded_visible_components() -> None:
    profile = resolve_roof_profile(10, 7, 6, "hip", "standard", "gray_tile")

    assert profile["pitched_details"] is True
    assert 0.08 <= profile["soffit_thickness"] <= 0.18
    assert 0.24 <= profile["eave_tile_width"] <= 0.42
    assert profile["ridge_cap_overlap"] < profile["ridge_cap_length"]
    assert profile["downspout_radius"] < profile["gutter_radius"]
    assert bounded_segment_count(
        200,
        profile["eave_tile_width"],
        profile["max_eave_tiles"],
    ) == profile["max_eave_tiles"]
    assert bounded_segment_count(
        5,
        profile["ridge_cap_length"] - profile["ridge_cap_overlap"],
        profile["max_ridge_caps"],
    ) > 1


def test_bounded_segment_count_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError, match="positive"):
        bounded_segment_count(0, 0.3, 20)
    with pytest.raises(ValueError, match="positive"):
        bounded_segment_count(4, -0.3, 20)
    with pytest.raises(ValueError, match="positive"):
        bounded_segment_count(4, 0.3, 0)


def test_flat_roof_uses_parapet_profile_instead_of_pitched_geometry() -> None:
    profile = resolve_roof_profile(10, 6, 5, "flat")

    assert profile["height"] == pytest.approx(0.18)
    assert profile["parapet_height"] == pytest.approx(0.60)
    assert profile["coping_width"] == pytest.approx(0.22)
    assert profile["ridge_axis"] == "x"
    assert profile["pitched_details"] is False


def test_downspouts_require_explicit_photo_evidence() -> None:
    assert should_add_downspouts(None) is False
    assert should_add_downspouts({"detected_features": []}) is False
    assert should_add_downspouts({"detected_features": ["chimney"]}) is False
    assert should_add_downspouts({"detected_features": ["downspout"]}) is True


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ((0, 6, 5, "hip"), "positive"),
        ((10, 6, 5, "mansard"), "roof type"),
        ((10, 6, 5, "hip", "vertical"), "roof pitch"),
        ((10, 6, 5, "hip", "standard", "glass"), "roof material"),
    ],
)
def test_roof_profile_rejects_invalid_dimensions_and_choices(args, message) -> None:
    with pytest.raises(ValueError, match=message):
        resolve_roof_profile(*args)
