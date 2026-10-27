# Component quality and approximate footprint implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task in the original main checkout; no worktrees.

**Goal:** Improve the existing local DINO/SAM component route without adding models or paid APIs.

**Architecture:** Keep fixed geometry. Accept near-rectangular footprints using the platform's existing opposing-edge averages, explicitly recording approximation. Infer balcony access and shallow recess only with spatial/pixel support; do not convert every railing into a door. Add procedural environment reflections to the browser.

**Tech Stack:** Python/OpenCV/Pillow, Blender 3.6, Three.js, Node tests, pytest.

- [x] Add failing tests for .969 footprint acceptance, strongly concave/courtyard rejection and disclosed approximation. Frontend and Worker gates must agree.
- [x] Add a pure balcony relation pass: accept floor-level, tall openings behind a balcony as glazed access; retain high-sill windows; preserve opening tops; reject overlaps. Use side-wall shading evidence for recesses and label depth as a design prior, not measurement.
- [x] Add explicit glazed-door geometry and retain relation metadata through normalization. Validate supported thresholds, continuous balcony slabs/side rails, and roof integrity in an actual Blender export.
- [x] Add browser environment reflections and controlled tone mapping; maintain device quality handling and run synthetic browser regression.
- [x] Generate before/after models from an existing cached detection and the original photo. Inspect rendered comparisons; report recognition limits, no claims of unseen depth accuracy.
- [x] Run regression and independent review. Prepare bounded updates for the current cloud/Worker deployment, reusing installed images and Blender with no model downloads. Remote changes remain manual and are not complete until receipts return.

Scope note: the optional Demo DINOv2 prototype retrieval was not migrated. This iteration must not silently download its weights or claim to restore that module. The fixes below reduce dependence on it; full retrieval remains a separate optional capability.

- [ ] Receive Aliyun idle preflight, 4090 quality rollout and Aliyun web update receipts; real-photo production acceptance remains pending.
