# GeoCalib and DeepLSD Facade A/B Experiment Design

## Goal

Measure whether GeoCalib and DeepLSD improve the existing single-global-H0 plus
structure-preserving-mesh facade workflow on the current difficult rural
building samples, without changing the production upload or model-generation
path.

## Samples

Use the existing full-resolution inputs and manifests for `sample_04`,
`sample_05`, and `sample_06`. Together they cover moderate oblique perspective,
strong side perspective, wide-angle distortion, clutter, and partial occlusion.
The existing hand-confirmed facade controls remain the reference, not training
data for either model.

## Compared Variants

Each sample produces four independently reproducible variants:

1. `baseline`: the existing controls, global H0, and constrained mesh.
2. `geocalib`: GeoCalib supplies camera/gravity/distortion priors before the
   existing geometry stage; existing controls remain unchanged.
3. `deeplsd`: DeepLSD supplies candidate line segments that are filtered by the
   current building mask, length, orientation, support, and vanishing-point
   consensus before the existing geometry stage.
4. `combined`: GeoCalib preprocessing followed by filtered DeepLSD candidates,
   then the same global H0 and constrained mesh.

No variant may compute a separate Homography for individual floors. GeoCalib
and DeepLSD are advisory inputs; the current H0 plus mesh remains the only
image-forming rectification stage.

## Isolation and Fallback

All new code and generated artifacts live under an isolated experiment area.
Production API, upload UI, Blender generation, and current manifests are not
modified. Model adapters return structured availability and diagnostics. If a
dependency, checkpoint, confidence threshold, or geometry validation fails,
the runner records the failure and still produces the baseline result.

Checkpoint files and generated images remain untracked runtime data. Source
code must not download weights during import or unit tests.

## Line Selection

DeepLSD output is converted to normalized source-image segments. Candidates are
rejected when they are too short, lie mostly outside the selected building
region, have weak confidence, or fail horizontal/vertical vanishing-point
consensus. Roof tiles, railings, fences, wires, vegetation, and neighboring
buildings must not dominate estimation. Existing confirmed controls remain
available as a reference overlay and fallback.

The experiment reports automatically selected lines separately from confirmed
reference lines. It must never present the latter as model detections.

## GeoCalib Use

GeoCalib estimates camera intrinsics, gravity, and optional radial distortion.
The undistorted/calibrated image is accepted only when its result is finite,
its confidence and camera parameters are plausible, and post-calibration line
residuals do not worsen beyond the configured tolerance. Source-to-calibrated
coordinate transforms are persisted so controls, masks, and detected lines use
one coordinate system.

## Outputs

For each sample and variant, generate:

- source image with accepted and rejected line candidates;
- calibrated or original working image;
- rectified facade;
- constrained-mesh diagnostic grid;
- side-by-side comparison;
- JSON metrics and timing record.

Generate one cross-sample HTML or image contact sheet and one JSON/CSV summary
that compares all available variants.

## Metrics

Report, without hiding failed variants:

- median and 95th-percentile horizontal angular residual;
- median and 95th-percentile vertical angular residual;
- horizontal and vertical vanishing-point inlier ratios;
- selected line count and rejected line categories;
- crop occupancy and retained facade-mask coverage;
- folded-triangle count and remap-pass count;
- per-stage runtime, peak CUDA memory when available, and fallback reason;
- difference from the hand-confirmed control result.

The trial is considered promising only if the combined or single-model variant
improves geometric residuals on at least two of the three samples without
reducing facade coverage, introducing folded triangles, or requiring more
manual controls than the baseline.

## Testing

Unit tests use synthetic camera results and line detections so they do not need
network access, CUDA, or model weights. They cover adapter absence, coordinate
mapping, candidate filtering, vanishing-point consensus, fallback behavior,
metric calculation, and deterministic report generation. A separate opt-in
integration command performs real checkpoint inference and writes runtime
artifacts.

## Linux Compatibility

Adapters expose the same interface on Windows and Linux and select CUDA only
when available. The experiment records package and checkpoint versions. The
Linux deployment will pin these dependencies in a dedicated GPU image after the
A/B result justifies production integration; DeepLSD full Ceres refinement is
out of scope for this first inference-only trial.

## Non-Goals

- No retraining or fine-tuning.
- No automatic production rollout.
- No generative removal of cars or vegetation in this comparison.
- No replacement of Grounding DINO plus SAM2.1 segmentation.
- No claim that official model benchmarks equal facade-rectification quality.
