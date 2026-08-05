# Structural Envelope H0 Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run samples 05 and 06 with larger target-building envelopes while retaining one global H0 and one structure-preserving mesh.

**Architecture:** Grounding DINO boxes are treated as target seeds. Small and medium boxes belonging to vertically adjacent parts of the same building are merged, while scene-sized boxes and adjacent buildings are rejected. The merged envelope is diagnostic evidence; a single front-facing quadrilateral inside it remains the only geometry passed to H0.

**Tech Stack:** Python, NumPy, OpenCV, Grounding DINO Base, SAM2.1 Large, existing constrained H0 mesh renderer.

## Global Constraints

- Do not use independent per-floor homographies.
- Do not overwrite previous experiment outputs.
- Keep one global H0 and one structure-preserving mesh per sample.
- Exclude adjacent buildings and scene-sized DINO boxes.

---

### Task 1: Building-box structural grouping

**Files:**
- Create: `experiments/facade_25d/structural_envelope.py`
- Test: `experiments/facade_25d/test_structural_envelope.py`

**Interfaces:**
- Produces: `merge_target_building_boxes(boxes, scores, image_shape) -> StructuralEnvelopeResult`.

- [ ] Write a failing test where vertically adjacent roof and wall boxes merge but a scene-sized and neighboring box do not.
- [ ] Run the focused test and confirm the missing API failure.
- [ ] Implement filtering, seed selection, and graph expansion minimally.
- [ ] Run the focused test and confirm it passes.

### Task 2: Two-sample diagnostic runner

**Files:**
- Create: `experiments/facade_25d/detect_building_envelopes.py`
- Create: `rural_house_generator/runtime_storage/facade_structural_envelope_20260803/`

**Interfaces:**
- Consumes: sample JPG files and `merge_target_building_boxes`.
- Produces: raw-box overlays, merged-envelope overlays, masks, and JSON diagnostics.

- [ ] Load DINO once and run samples 05 and 06.
- [ ] Save all accepted boxes and the selected merged envelope.
- [ ] Visually verify the target envelope includes the complete target without adjacent houses.

### Task 3: Stable H0 rerun

**Files:**
- Create: experiment manifests under `rural_house_generator/runtime_storage/facade_structural_envelope_20260803/`.
- Reuse: `experiments/facade_25d/run_constrained_mesh.py`.

**Interfaces:**
- Consumes: one front-facing quadrilateral and existing line constraints per sample.
- Produces: one H0 + structure-mesh result per sample.

- [ ] Derive one conservative front quadrilateral inside each merged building envelope.
- [ ] Run the existing constrained mesh renderer without per-floor transforms.
- [ ] Record folded-triangle and resample diagnostics.
- [ ] Generate one side-by-side comparison and run all focused tests.
