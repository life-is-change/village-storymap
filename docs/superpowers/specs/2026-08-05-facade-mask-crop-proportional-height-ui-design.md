# Facade mask crop, proportional height and UI design

## Goal

Make photo-textured white models use the detected building rather than surrounding pixels: remove side margins after the roof cut, derive wall height from the prepared facade aspect ratio and the white-model front length, and simplify the photo-mode interface.

## Decisions

### Mask-based side crop

The rectification pipeline already produces a warped SAM 2.1 building mask. The pipeline will save a copy cropped to the exact same bounds as `rectified_source.png`. During `prepare-direct`, the student roof cut is applied to both the image and the aligned mask. Horizontal bounds come from columns with building-mask support, with a small proportional padding. The existing color heuristic remains only for legacy and explicit-original flows where no aligned mask exists.

### Proportional wall height

For photo mode, the prepared facade is authoritative. After roof removal and side trimming:

`wall height = building front length × texture pixel height ÷ texture pixel width`

The result is clamped only by the backend schema safety range, not by the former 9 m convention. Roof height is recomputed from the derived wall height: 18% for hip/gable and 4% (minimum 0.2 m) for flat roofs. The updated dimensions are stored in the job before Blender generation and returned to the browser for model metrics.

### UI

The photo-mode form keeps front length, depth and roof type. Floor count and floor height are hidden in photo mode and replaced by a read-only proportional-height summary after preparation. The header uses a compact description, a non-wrapping action group on desktop and an intentional stacked layout on narrow screens.

## Error handling and compatibility

- Invalid or empty masks fall back to the existing image-content crop rather than blocking the job.
- Preset generation keeps its existing floor-based height behavior.
- Existing jobs without the aligned mask remain supported.
- Re-preparing a photo recomputes height from the latest crop.

## Verification

- Python unit tests cover aligned-mask cropping and proportional height updates.
- JavaScript tests cover photo-mode field visibility/state and returned model metrics.
- A real local job is re-prepared and generated to inspect the resulting texture and Blender manifest.
