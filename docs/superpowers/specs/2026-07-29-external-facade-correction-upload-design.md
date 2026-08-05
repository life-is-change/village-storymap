# External Facade Correction and Direct Texture Upload Design

## Goal

Replace the local four-corner perspective-correction workflow in the rural house generator with a simpler external-correction workflow. Users obtain a clean, axis-aligned standard front-elevation image from Doubao, upload that image, and generate a GLB whose front face displays the uploaded image without further local geometric correction.

## User Workflow

1. Select the standard-front-elevation texture mode in the white-model texturing interface.
2. Copy the default prompt: `把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影`.
3. Open the official Doubao web chat at `https://www.doubao.com/chat/` in a new tab and use the prompt with the source photograph.
4. Download the corrected image from Doubao.
5. Upload one JPG or PNG standard front-elevation image to the local interface and review its preview.
6. Enter the building length, depth, floor count, and floor height, then generate the textured GLB.
7. Preview and download the GLB or send it back to the originating village-planning page through the existing handoff contract.

## Interface Changes

- Rename the current photo mode and its copy so that it consistently describes a standard front-elevation texture rather than an ordinary perspective photograph.
- Add a visible preparation panel containing:
  - an `打开豆包` external link;
  - a read-only display of the default correction prompt;
  - an `复制提示词` button with success and failure feedback;
  - short instructions that make the external round trip explicit.
- Accept exactly one JPG or PNG file up to 10 MB.
- Replace the multi-photo chooser and four-corner canvas editor with a single-image preview.
- Tell users that the uploaded image must be clean, axis-aligned, and contain the complete front elevation. The application will not perform perspective correction or infer metric dimensions.
- Retain the existing building-dimension controls, progress display, GLB download, and replacement handoff.

## Model Representation

The uploaded image is mapped once across the complete rectangular front plane of a simple white box model. The side, rear, and top faces use a neutral white material. The image may already contain a visually rendered roof, as in the supplied example; therefore the direct-texture mode does not add a separate front-facing gable roof that would duplicate it.

This is intentionally a facade-textured massing model rather than a reconstructed architectural model. It produces a faithful front view and a simple volumetric presence from oblique views. Recovering roof geometry, balconies, openings, or depth from one image is outside this iteration.

## Data Flow and API

1. The browser validates one selected image and the numeric building fields.
2. The browser creates a job with the image and building dimensions using the existing multipart job endpoint.
3. A new direct-preparation operation validates that the stored image can be decoded and copies or losslessly converts it to the canonical facade texture artifact. It performs no Homography, four-corner warp, generative correction, segmentation, or automatic crop.
4. Generation passes the canonical texture and building dimensions to Blender.
5. Blender creates the neutral box, applies the texture to the outward-facing front plane with upright UV coordinates, embeds the texture in the GLB, and exports `building.glb`.
6. The browser downloads and previews the artifact and preserves the existing `village-house-generator:model-ready` message shape when sending it back to the main platform.

The direct-preparation endpoint is kept separate from generation so image validation failures remain distinct from Blender failures. The old corner-based preparation code may remain temporarily for compatibility with existing tests or callers, but it is removed from the active interface and is not invoked by this workflow.

## Error Handling

- Reject missing files, multiple files, unsupported media types, and files larger than 10 MB before upload where possible and again on the server.
- Reject images that cannot be decoded and explain that a valid JPG or PNG is required.
- Validate all building dimensions as finite positive values and report the invalid field.
- Report unavailable local service, unavailable Blender executable, generation timeout, invalid GLB, and artifact-download failures in concise Chinese UI messages.
- If clipboard access is unavailable, keep the prompt selectable and tell the user to copy it manually.
- Opening Doubao must use `target="_blank"` with `rel="noopener noreferrer"`; no account information or image data is sent to Doubao by this application.

## Example Acceptance Run

Use the user-supplied corrected facade image as the standard upload. Generate a direct-texture GLB with the interface's default dimensions; this run validates the workflow and texture orientation, not real-world dimensional accuracy. The acceptance artifacts are:

- the stored canonical facade texture;
- a binary GLB beginning with the `glTF` header;
- a Blender-rendered preview showing the supplied facade upright, uncropped, and not mirrored on the front face;
- the downloadable model opened successfully by the web preview.

## Testing

- Frontend unit tests cover single-file validation, direct workflow state transitions, building-field mapping, prompt content, and the platform handoff message.
- Backend API tests cover direct preparation, undecodable input, canonical texture creation, generation preconditions, and persistence across application restart.
- Blender tests verify command construction, direct-texture path use, GLB creation, front-plane UV orientation, and neutral non-front faces.
- Existing preset-generation and platform-handoff tests must continue to pass.
- The final verification runs relevant Node and Python tests, then executes the supplied image through the live local backend and Blender and visually inspects the rendered result.

## Non-goals

- Local perspective correction, four-corner editing, vanishing-point estimation, segmentation, cropping, or generative image repair.
- Calling Doubao through an API, automating a user's Doubao session, or transferring images between the two applications.
- Reconstructing doors, windows, balconies, roof slopes, or other facade elements as separate 3D geometry.
- Inferring accurate dimensions from a single image.
- Applying the same single image to side or rear facades.
