# Facade 2.5D Orthographic Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate whether manually separated photographic facade planes can be transformed into an Image-2-like frontal orthographic elevation while retaining source pixels.

**Architecture:** A manual manifest identifies planar quadrilaterals for the roof, two balcony fronts, separating wall bands, ground floor, and base. Each quadrilateral is independently rectified into a destination rectangle on a neutral canvas. This canvas is the exact front view that a 2.5D Blender orthographic camera would see; Blender integration is deferred until the atlas is visually accepted.

**Tech Stack:** Python 3, OpenCV, NumPy, pytest; existing Blender 4.x for the later accepted stage.

## Global Constraints

- Isolated experiment only; do not modify the webpage or API.
- Retain source photograph pixels inside every configured plane.
- Do not use a generative model.
- Do not commit.
- Manual plane coordinates are permitted for this one-building feasibility test.

---

### Task 1: Plane Rectification and Orthographic Composition

**Files:**
- Create: `experiments/facade_25d/__init__.py`
- Create: `experiments/facade_25d/orthographic.py`
- Create: `experiments/facade_25d/test_orthographic.py`

**Interfaces:**
- `rectify_plane(image, source_quad, output_size) -> image`
- `compose_planes(image, planes, output_size, background) -> image`

- [ ] Write tests proving a synthetic trapezoid becomes a rectangle and its photographic colors remain intact.
- [ ] Run tests and verify they fail because the implementation is absent.
- [ ] Implement independent homographies and destination-box composition.
- [ ] Run tests and verify they pass.

### Task 2: Real House Manual Manifest and Preview

**Files:**
- Create: `experiments/facade_25d/sample_01.json`
- Create: `experiments/facade_25d/run_sample.py`
- Create: `experiments/facade_25d/test_run_sample.py`
- Create at runtime: `rural_house_generator/runtime_storage/facade_25d/sample_01/*`

**Interfaces:**
- Consumes the staged first photograph and seven manually configured planes.
- Produces source-plane overlay, orthographic atlas, and source-vs-atlas comparison.

- [ ] Write a failing temporary-manifest runner test.
- [ ] Implement validated manifest loading and diagnostic output.
- [ ] Run the real sample and inspect every plane seam and retained detail.
- [ ] Run both facade experiment suites and report the actual visual limitation.
