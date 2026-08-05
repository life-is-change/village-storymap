# Revised facade plane pipeline experiment

**Goal:** Re-run samples 01, 04, 05, and 06 with target-building isolation, conservative occlusion cleanup, and a plane-only orthographic facade atlas.

## Design

1. Keep the existing Grounding DINO Base + SAM2.1 Large building masks as target-instance evidence.
2. Detect removable occluders on the source image so vehicles near the old crop boundary still have surrounding context.
3. Permit LaMa only for masks below 8% of the target region and reject masks touching the source boundary; always retain a faithful output.
4. Use the existing H0 + structure-preserving mesh result as the shared geometric reference.
5. Select only vertical facade bands. Exclude balcony soffits, roof undersides, and visible side walls.
6. Rectify each selected band independently to an axis-aligned destination rectangle, then tightly crop the union so no empty side margins remain.
7. Produce per-sample diagnostics and one contact sheet comparing source, previous H0, faithful plane atlas, mask, and cleanup candidate.

## Verification

- Unit tests cover conservative inpainting gates and tight plane-atlas cropping.
- Every output plane is axis-aligned in atlas coordinates.
- Output alpha/mask reaches the tight crop boundary without blank side columns.
- The faithful image is always present; LaMa is marked skipped when its evidence is unsafe.
- Visually inspect all four contact-sheet rows before reporting results.
