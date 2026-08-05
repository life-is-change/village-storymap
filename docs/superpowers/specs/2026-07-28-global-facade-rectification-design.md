# Global Facade Rectification Design

## Goal

Replace independent floor-by-floor Homographies with one shared rectification for the main facade wall. Floors that are intended to be coplanar must keep common vertical wall lines, one horizontal direction, and one vertical direction after rectification. Roof edges, balcony slabs, canopies, and other protruding elements remain separate overlays.

This remains an isolated experiment. It does not modify the production upload workflow, webpage, or API, and it does not create a Git commit.

## Approaches Considered

### Recommended: shared vanishing-point rectification

Use several manually confirmed horizontal and vertical architectural line segments from the entire building. Estimate one horizontal vanishing point and one vertical vanishing point, build a single rectifying transform, and apply it to the whole main-wall image region. Multiple lines reduce sensitivity to any one inaccurate endpoint and guarantee that both floors use the same directions.

### Rejected: one global four-corner quadrilateral

This is simpler, but the second sample has hidden ground-floor corners. Guessing one corner can rotate or shear the complete facade, so it repeats the same failure at a larger scale.

### Deferred: constrained piecewise mesh warp

A mesh can handle non-planar facades and local alignment constraints, but it introduces more degrees of freedom, risks bending doors and windows, and is unnecessary before the global planar method is tested.

## Inputs

Each sample provides normalized coordinates for:

- at least two horizontal line segments selected from eaves, floor slabs, lintels, or window rows;
- at least two vertical line segments selected from door and window jambs on different sides of the facade;
- a main-wall crop polygon;
- optional overlay planes for roof fascia, balcony slab fronts, and canopies;
- an output width and either an approximate physical aspect ratio or an automatically estimated image-space aspect ratio.

The system must reject parallel-line sets that cannot produce a stable finite vanishing point, degenerate crop polygons, and transforms that map the wall outside a bounded output canvas.

## Geometry Pipeline

1. Convert normalized line endpoints to source pixels.
2. Fit one vanishing point to all horizontal lines and another to all vertical lines using least-squares homogeneous line intersection.
3. Construct a projective rectification that sends both vanishing points to infinity.
4. Apply an affine adjustment so the two facade axes are perpendicular and vertical features point upward.
5. Transform the entire main-wall crop once. Derive its output bounds from the transformed polygon and the selected aspect-ratio rule.
6. Composite protruding planes afterward with the existing feathered overlay mechanism.

No floor is allowed to define an independent main-wall Homography.

## Components

- `experiments/facade_25d/global_rectification.py`: line fitting, vanishing-point estimation, transform construction, output bounding, and global wall warp.
- `experiments/facade_25d/run_global_sample.py`: manifest parsing, diagnostics, rendering, and comparison output.
- `experiments/facade_25d/test_global_rectification.py`: synthetic perspective-grid regression tests.
- Sample manifests: line selections and overlay configuration for the two real photographs.

## Diagnostics

Every run outputs:

- the source image with selected lines and fitted vanishing directions;
- the globally rectified main wall before overlays;
- the final atlas with overlays;
- a source/result comparison;
- numeric residuals measuring horizontal slope, vertical slope, and cross-floor collinearity.

## Validation

The prototype passes when:

- synthetic horizontal and vertical grid lines are rectified to within one pixel across the test image;
- door or window jambs selected on both floors are vertical in the result;
- a shared wall line crossing both floors remains collinear, rather than changing x-coordinate at a floor seam;
- the output aspect ratio is not manually stretched beyond a configurable tolerance;
- both existing real samples render without independent main-wall floor transforms;
- existing facade experiment tests continue to pass.

## Non-goals

- reconstructing pixels hidden by vegetation, balcony slabs, or canopies;
- inferring true physical dimensions without a known measurement;
- correcting genuinely non-coplanar wall sections with the global wall transform;
- integrating the prototype into the production application in this iteration.
