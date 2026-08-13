# Existing Building Photo Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the rural-house generator reuse photos already uploaded for the selected 2D building.

**Architecture:** The generator requests photo metadata from its same-origin opener with `postMessage`. The 3D platform queries Supabase through the already-authenticated shared client, including the current `building` namespace and the legacy per-space namespace, then returns a deduplicated list. Selecting a card downloads the public image as a `File` and enters the existing photo-processing pipeline.

**Tech Stack:** Browser JavaScript, Supabase JS client, HTML/CSS, Node test runner.

## Global Constraints

- Keep local file upload available as a fallback.
- Do not initialize another Supabase client in the generator.
- Accept messages only from the same origin.
- Do not create a Git commit.

---

### Task 1: Photo material message contract

**Files:**
- Create: `rural_house_generator/photo-material-bridge.js`
- Create: `rural_house_generator/photo-material-bridge.test.js`

**Interfaces:**
- Produces: message constants, photo normalization/deduplication, safe filename and MIME inference.

- [ ] Write failing unit tests for normalization, deduplication, and file metadata.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the browser/CommonJS-compatible helper.
- [ ] Run the focused test and confirm it passes.

### Task 2: Authenticated opener bridge

**Files:**
- Modify: `app-3d.js`
- Modify: `app.js`
- Test: `features/auth/supabase-auth-integration.test.js`

**Interfaces:**
- Consumes: generator request containing `sourceCode` and `spaceId`.
- Produces: same-origin response containing deduplicated photo metadata or a readable error.

- [ ] Add failing integration assertions for the request/response bridge and shared client.
- [ ] Run the focused integration test and confirm it fails.
- [ ] Query `object_photos` for `building` plus `building__<spaceId>` and reply to the requesting window.
- [ ] Update the 3D script cache version and rerun the focused test.

### Task 3: Existing-photo selector

**Files:**
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`
- Test: `rural_house_generator/photo-material-bridge.test.js`

**Interfaces:**
- Consumes: photo-material response from the opener.
- Produces: selectable photo cards whose action calls the existing `setPhotoFile(file)` workflow.

- [ ] Add markup and source-level assertions for loading, empty, error, and photo-card states.
- [ ] Implement the message request/listener and renderer.
- [ ] Fetch the chosen public image, convert it to a validated `File`, and call `setPhotoFile`.
- [ ] Keep the upload control visible and report recoverable fetch errors.
- [ ] Run focused tests, the full Node suite, syntax checks, and a local browser smoke test.
