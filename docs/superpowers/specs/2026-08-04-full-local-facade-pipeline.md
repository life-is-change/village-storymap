# Full local facade pipeline

## Goal

Convert one student-uploaded building photo into a cleaned, axis-aligned facade texture before the student chooses the roof cut line and generates the white model.

## Production flow

1. Grounding DINO Base detects the target building and related building fragments.
2. SAM 2.1 Large converts the selected building envelope into the main-building mask.
3. Grounding DINO and SAM 2.1 detect cars, motorcycles, people, vegetation, clothes and canopies.
4. Safety gates restrict cleanup to plausible foreground occluders. A persistent LaMa worker inpaints the accepted mask; a LaMa failure preserves the source instead of failing geometry.
5. Architectural lines are detected only within the SAM building support.
6. A global H0 resolves the horizontal and vertical vanishing directions, then the constrained mesh regularizes residual local drift in one resampling pass.
7. The warped building mask removes side background without cutting the main building.
8. The UI shows the rectified result. Only then may the student drag the roof boundary and generate the textured model.

## Runtime architecture

- Port 8011: FastAPI job/model backend (`building_facade_pilot`).
- Port 8012: persistent Grounding DINO + SAM 2.1 worker (`building_sam2`).
- Port 8013: persistent LaMa worker (`building_lama`).
- The launcher configures all endpoints and enables the `full-local` production pipeline.
- Model and inpaint failures are explicit; the original-photo fallback remains an explicit user action.

## Portability

The Python modules and HTTP contracts are platform-neutral. Windows paths exist only in the launcher. Linux deployment supplies `BUILD_SEG_ROOT`, `SAM2_CHECKPOINT`, `RURAL_FACADE_ML_URL`, `RURAL_LAMA_URL`, and starts the same three modules with Linux Python executables.

## Validation

- Unit tests cover worker contracts, mask-based bounds, architectural-line orientation, API persistence, cropping, Blender generation and front-end workflow.
- The real sample `32a9d1e9437eb3791df67f8d3b55d7ca.jpg` must produce the DINO/SAM masks, a LaMa candidate and an upright H0/mesh facade before release.
