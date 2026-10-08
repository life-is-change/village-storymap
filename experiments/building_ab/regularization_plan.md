# Building Footprint Regularization Experiment Plan

**Goal:** Convert the existing strict-profile GeoJSON into rectangle-first footprints while retaining genuine L/T/composite buildings as 6-8 edge orthogonal polygons.

**Architecture:** Work only on the already-generated GeoJSON. Convert each small WGS84 ring to a local metre plane, classify it by rotated-rectangle fill, then either emit a minimum-area rectangle or simplify and snap a complex outline to its dominant pair of perpendicular directions. Convert the result back to WGS84 and record diagnostic metadata.

**Constraints:**

- Do not modify the Linux production pipeline during this experiment.
- Do not run model inference again.
- Do not add Shapely/GeoPandas/GDAL dependencies.
- Ordinary buildings should have 4 vertices; genuine L/T/composite buildings may have 6-8.
- Reject a candidate if it is self-intersecting, degenerate, or changes area excessively.
- Do not create a Git branch or commit.

## Task 1: Geometry core (TDD)

- [ ] Add failing tests for rotated rectangles, general quadrilaterals, L shapes, noisy outlines, vertex caps, and invalid rings.
- [ ] Run the tests and confirm they fail because the new module does not exist.
- [ ] Implement local projection, simplification, dominant-axis snapping, validation, and metadata.
- [ ] Run all geometry tests until green.

## Task 2: Batch processor and preview

- [ ] Add a command that reads strict `buildings.geojson` and writes a separate regularized GeoJSON.
- [ ] Add a renderer showing current Linux outlines beside experimental outlines on the source TIFF.
- [ ] Write JSON statistics for vertex counts, rule types, and area-change distribution.

## Task 3: Experimental verification

- [ ] Process all 262 strict-profile features without rerunning inference.
- [ ] Confirm every output ring is closed and has 4, 6, or 8 vertices unless explicitly marked fallback.
- [ ] Inspect overview and detail previews for false enlargement, orientation errors, and residual curved-looking outlines.
- [ ] Report whether the experiment is suitable for later integration into Linux.
