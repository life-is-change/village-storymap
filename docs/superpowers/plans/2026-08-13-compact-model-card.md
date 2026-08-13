# Compact Model Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model-library cards readable and usable inside the narrow 3D information sidebar without horizontal scrolling.

**Architecture:** Keep the existing model-library data and event handlers. Change only the card markup emitted by `buildModelReplaceCardHtmlV3` and its focused CSS, with source-level integration tests protecting the narrow-panel behavior.

**Tech Stack:** Vanilla JavaScript, CSS, Node.js built-in test runner.

## Global Constraints

- Preserve all existing model upload, reuse, deletion, permission, confirmation, and audit behavior.
- Do not commit or push Git changes.
- Keep `.glb` and 50 MB upload constraints unchanged.

---

### Task 1: Compact model card markup and layout

**Files:**
- Modify: `features/models/group-model-library-integration.test.js`
- Modify: `app-3d.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `currentLibraryAssets`, `modelState.modelAssetId`, `currentLibraryBinding.asset_id`.
- Produces: `.group-model-card`, `.group-model-card-status`, `.group-model-card-size`, `.group-model-delete-btn`, and `.group-model-apply-btn` markup styled for the narrow sidebar.

- [ ] **Step 1: Write the failing integration test**

Add assertions that the rendered source exposes a “使用中” status, an accessible delete action, `overflow-x: hidden`, a one-column action layout, and a two-line wrapping model name.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test features/models/group-model-library-integration.test.js`

Expected: FAIL because the compact status markup and overflow/layout rules do not exist yet.

- [ ] **Step 3: Implement the minimal markup and CSS**

Compute one `isActive` flag per asset, add the status and size tags, put deletion in the card header, keep apply as the sole full-width primary action, and constrain all card children with `min-width: 0` and overflow rules.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
node --test features/models/group-model-library-integration.test.js
$tests = Get-ChildItem -Path features -Recurse -Filter *.test.js | ForEach-Object { $_.FullName }
node --test $tests
node --check app-3d.js
git diff --check
```

Expected: all tests pass, syntax check exits 0, and diff check reports no whitespace errors.
