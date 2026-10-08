# Facade Body Crop and Independent Roof Design

## Goal

Make the standard-elevation workflow obvious and student-friendly while separating the photographed wall body from a generated three-dimensional roof.

## Confirmed Interaction

- After one corrected JPG or PNG is uploaded, the upload card shows a visible `按当前范围生成模型` button. The existing top-bar generate button remains and invokes the same action.
- The preview shows one horizontal roof-boundary handle. The student drags only this line to the boundary below the photographed roof. The shaded area above the line is excluded; the unshaded area below becomes the wall texture.
- Left and right blank background regions are removed automatically. Students do not adjust horizontal crop handles.
- Roof type is the only roof control: `四坡屋顶` (default), `双坡屋顶`, or `平屋顶`. Roof height is computed automatically as 18% of wall height for sloped roofs; a flat roof uses a shallow cap.

## Image Processing

The browser sends a normalized `crop_top` in the range 0–0.65. The backend first removes all rows above that boundary, then estimates the background color from the remaining image corners. A foreground mask combines color distance from the corner background and image edges. Columns with meaningful foreground evidence define the left and right content bounds, expanded by a small safety margin. Top and bottom are not altered beyond the explicit roof boundary.

If no reliable foreground interval exists, the backend keeps the full remaining width rather than returning an empty or destructive crop. The canonical PNG remains lossless after decoding and contains only the wall-body region used by Blender.

## Model Geometry

- A rectangular neutral-white body represents the wall mass.
- The cropped wall image is mapped upright to the front wall plane only.
- The roof is a separate mesh with a dark neutral tile-like material and a small eave overhang.
- A hipped roof uses a centered ridge and four roof slopes; a gable roof uses the existing two-slope geometry; a flat roof uses a shallow rectangular cap.
- Model metrics include wall height plus generated roof height.

## Validation

- JavaScript tests cover crop-bound clamping, automatic roof height, roof-type mapping, and direct-prepare URL construction.
- OpenCV tests prove that top rows and left/right blank margins are removed while internal white wall pixels remain.
- API tests prove `crop_top` validation and canonical output dimensions.
- Real Blender tests assert that the selected roof mesh exists separately from `Building body` and `Photo facade`.
- Browser acceptance confirms the contextual generate button, one-line crop interaction, automatic white-margin removal, correct wall texture orientation, and an independent roof on the supplied facade image.

## Non-goals

- Automatic semantic detection of the roof-to-wall boundary.
- Manual left, right, or bottom crop handles.
- Reconstructing the photographed roof shape or texture.
- Applying the wall photograph to roof, side, or rear surfaces.
