# Facade Shared-Seam Rectification Design

## Goal

Turn the manually selected facade planes into an Image-2-style orthographic facade: the main wall has one consistent left and right edge, floor boundaries meet without gaps or jumps, and doors and windows remain vertical.

This iteration stays inside the experimental facade pipeline. It does not change the production webpage or API and does not create a Git commit.

## Root Cause

The current renderer rectifies every facade band into an independent destination rectangle and copies the result directly onto the atlas. Adjacent bands may touch numerically, but they use different horizontal extents and independently selected source boundaries. As a result, architectural content jumps at their shared boundary. Door and window corrections are also copied as hard rectangular patches, which exposes their patch edges.

## Geometry

- Define one canonical main-wall interval, `x_left` to `x_right`, shared by every main facade band.
- Define a single ordered list of floor seam positions. The bottom edge of one wall band and the top edge of the next must reference the same seam value before pixel rounding.
- Treat roof edges, balcony fronts, eaves, and the ground-floor canopy as overlays. They may extend beyond the main wall, but they do not determine its width.
- Keep door and window planes independent so their four edges can be rectified without changing the surrounding wall.

## Composition

- Render the main wall bands first using the shared skeleton.
- Render protruding architectural overlays from back to front.
- Blend only a narrow 2 to 4 pixel strip at shared floor seams. The blend must not move the seam or blur a large area.
- Composite door and window corrections with polygon masks and a narrow feather instead of hard rectangular replacement.

## Validation

The sample passes when:

- the main facade's left and right edges remain aligned through all floors;
- no background gap or visible content jump appears at a floor seam;
- balcony and canopy projections remain distinguishable from the main wall;
- the ground-floor entry door and selected windows are vertical;
- patch boundaries around corrected openings are not conspicuous at normal viewing scale;
- existing facade experiment tests pass, with new regression tests covering shared pixel seams and masked composition.

## Non-goals

- Reconstructing hidden geometry behind balconies;
- correcting the roof as a full 3D surface;
- removing all railings, vegetation, clothes, wires, or text;
- integrating this experiment into the production upload workflow in this iteration.
