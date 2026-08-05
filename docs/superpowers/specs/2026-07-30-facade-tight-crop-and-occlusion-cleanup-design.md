# Facade Tight Crop and Occlusion Cleanup Design

## Goal

Produce a front-elevation atlas that keeps every confirmed front-facing building surface, excludes side faces and surroundings, and contains no configured white margin. Preserve a faithful pixel-remapped result and generate any occlusion-cleaned result as a separate, explicitly generative variant.

## Root Cause

The current canvas uses the intersection of the four rectified crop edges. A slanted multi-depth outline therefore clips upper corners while retaining unrelated side content. A fixed 30-pixel padding creates visible white margins. One crop quadrilateral also mixes roof fascia, recessed wall, balcony and ground wall, which cannot share one physical boundary even when they share one global vanishing-point transform.

## Geometry

1. Estimate one global `H0` from confirmed horizontal and vertical front-facade lines.
2. Transform the complete source image to a union-bounds canvas so no selected surface is clipped.
3. Represent roof fascia, upper wall, balcony fascia and ground wall as front-surface polygons. All polygons use the same `H0`; no layer receives another Homography.
4. Rasterize the transformed polygons into one validity mask. The outline may step inward or outward between architectural bands, but each declared left and right band boundary is vertical in the atlas.
5. Crop to the nonzero validity-mask bounding box with zero default padding and set pixels outside the mask transparent.

## Occlusion Cleanup

The faithful atlas remains an original-pixel result. A second optional output uses the existing local LaMa worker and an explicit occluder mask. Windows, doors, signs, railings and unmasked pixels are protected. Cars, scooters and small vegetation over broadly predictable surfaces may be masked. Large trees or canopies hiding unknown openings are retained unless a generated reconstruction is explicitly accepted; the experiment may still render a candidate, but it cannot replace the faithful atlas.

## Outputs

- faithful tight RGBA atlas;
- faithful atlas over a neutral preview background;
- transformed front-surface mask;
- source controls and comparison image;
- optional cleaned candidate and its occlusion mask;
- JSON diagnostics for bounds, padding, valid extent, resampling count and inpainting provider.

## Validation

- No selected transformed polygon vertex lies outside the pre-crop canvas.
- Final alpha-mask bounding box touches all four output sides when padding is zero.
- Every declared band boundary is vertical after `H0` mapping.
- The faithful result uses one remap pass and no generated pixels inside its valid mask.
- Cleaned output dimensions equal faithful output dimensions and unmasked protected pixels are unchanged.
- Existing facade tests remain green.

## Scope

This is an isolated experiment for samples 04 and 05. It does not yet change the production upload UI or make LaMa output the default texture.
