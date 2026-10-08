# Constrained Multilevel Facade Rectification Design

## Goal

Rectify a multi-storey facade without independent floor Homographies. One global projective transform `H0` establishes the shared wall plane. A bounded continuous mesh may then compensate for small non-coplanar balcony or canopy offsets. The final pixels are sampled from the original photograph exactly once.

## Existing Structure and Failure Mode

- `experiments/facade_25d/orthographic.py` calls `getPerspectiveTransform` and `warpPerspective` independently for every `PlaneSpec`. Each floor therefore owns a different scale, axis and boundary, so seams can be straight locally while remaining discontinuous globally.
- `experiments/facade_25d/global_rectification.py` fits shared horizontal and vertical vanishing points and applies one wall transform. It fixes cross-floor projective inconsistency but cannot reduce small local residuals caused by balconies, canopies or imperfect manual lines.
- The new mode must not call the per-plane renderer. It extends the global method with a low-degree-of-freedom continuous correction only.

## Chosen Approach

1. Fit one `H0` from horizontal and vertical architectural lines spanning all floors.
2. Place the transformed wall crop on one output canvas with one width, one left/right boundary and one height scale.
3. Build a shared rectangular control mesh on that canvas. Rows include storey boundaries and important slab/eave seams; columns include outer walls, the central axis and important cross-floor axes.
4. Optimize a structure-preserving separable parameterization with `scipy.optimize.least_squares`: every column owns one shared x offset across all rows and every row owns one shared y offset across all columns.
5. Evaluate horizontal, vertical, cross-floor axis, shared level, boundary, scale, smoothness and displacement residuals together.
6. Invert the optimized triangular mesh into one pair of OpenCV remap arrays and call `cv2.remap` once.

No region receives a second projective transform. Every optimized mesh column is exactly vertical and every optimized mesh row is exactly horizontal, so adjacent floors cannot bend or drift independently.

## Constraints

- Horizontal line endpoint y-coordinates should match.
- Vertical line endpoint x-coordinates should match.
- Points in a named cross-floor axis group should share one x-coordinate.
- Points in a named shared-level group should share one y-coordinate.
- Boundary vertices remain anchored to the global wall rectangle.
- Adjacent mesh edge scales remain close to the H0 result.
- First and second one-dimensional row/column offset differences are penalized.
- Main-wall displacements are bounded to 5 px in each direction for the real sample.
- Folded or degenerate triangles are rejected.

## Inputs

The manifest reuses `main_wall.crop_polygon`, `horizontal_lines` and `vertical_lines`. A `mesh` section adds normalized row/column positions, maximum local displacement, optimizer weights, cross-floor `axis_groups` and shared `level_groups`. All feature coordinates remain normalized source-image coordinates.

## Outputs

- source photograph with all control lines and groups;
- final corrected facade sampled from the original image;
- corrected facade with the base and optimized mesh overlaid;
- source/result comparison;
- JSON parameters containing `H0`, base and optimized vertices, source sampling vertices, optimizer status, residuals and one-pass resampling diagnostics.

## Validation

- A synthetic multi-storey perspective grid must reduce joint constraint residuals without moving the wall boundary.
- Mesh rows are shared objects rather than independently transformed floor edges.
- A patched `cv2.remap` call counter must observe exactly one final resampling call.
- A runner integration test must decode all diagnostic outputs and parameters.
- Existing facade experiment tests must remain green.

## Non-goals

- recovering pixels hidden by vehicles, plants, railings or canopies;
- changing doors, windows, text or building components;
- generative completion;
- estimating metric dimensions from one uncalibrated photograph;
- integrating the experiment into the production UI in this iteration.
