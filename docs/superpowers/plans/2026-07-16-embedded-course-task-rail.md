# Embedded Course Task Rail Implementation Plan

> **过程文档：** 本文件记录实施步骤和验证过程，不属于平台运行文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone course workbench page with a collapsible far-left task rail embedded in the existing 2D/3D workspace.

**Architecture:** Keep the existing OpenLayers/Cesium views as the only working surface. Render course navigation and active-task guidance inside a new first grid column, while the original story panel and detail panel remain intact. Activity events continue syncing silently; the student UI no longer renders the event list.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js built-in test runner, OpenLayers, Cesium, Supabase.

## Global Constraints

- Work directly on the current `master` worktree as previously authorized.
- Do not commit, stage, push, or create a branch unless the user asks.
- Preserve existing unrelated working-tree changes.
- Use test-first changes for course rendering and layout behavior.
- Keep process documents clearly marked and outside runtime code.

---

### Task 1: Define the compact task panel behavior

**Files:**
- Modify: `features/ui/course-workbench.test.js`
- Modify: `features/ui/course-workbench.js`

**Interfaces:**
- Consumes: `DEFAULT_COURSE`, course service context, activity logger.
- Produces: `renderTaskNavigation()`, `renderDashboard()`, `createCourseWorkbench()` without standalone page cards or student event output.

- [ ] Add failing tests asserting icon navigation, stage-specific panel content, no platform-entry copy, and no “最近操作”.
- [ ] Run the focused tests and confirm the new assertions fail.
- [ ] Replace the large dashboard renderer with a compact active-task drawer.
- [ ] Keep activity logging in event handlers but remove activity rendering.
- [ ] Run focused tests and confirm they pass.

### Task 2: Move the course UI into the far-left workspace column

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Create: `features/ui/course-task-layout.test.js`

**Interfaces:**
- Consumes: `#courseTaskNav`, `#courseWorkbenchContent`, existing `.main-layout`.
- Produces: `#courseTaskSidebar`, `#courseTaskToggleBtn`, four-column workspace order.

- [ ] Add a failing source-layout test asserting task sidebar precedes the original story panel and the standalone course view is absent.
- [ ] Run the layout test and confirm failure.
- [ ] Move task navigation/content into a dedicated far-left aside.
- [ ] Add collapsed and expanded widths, icon highlighting, tooltip labels, and responsive behavior.
- [ ] Run layout tests and confirm pass.

### Task 3: Keep the map active while tasks change

**Files:**
- Modify: `app.js`
- Modify: `features/ui/course-task-layout.test.js`

**Interfaces:**
- Consumes: existing `switchMainView("plan2d" | "model3d")`, base/group planning spaces.
- Produces: direct homepage-to-2D entry, persistent sidebar toggle, no `courseWorkbench` view mode.

- [ ] Add failing tests asserting the entry handler opens the map and source no longer switches to a course workbench view.
- [ ] Run tests and confirm failure.
- [ ] Change platform entry to refresh course context and open the relevant 2D space.
- [ ] Remove the standalone course view branch from layout switching.
- [ ] Bind the task sidebar expand/collapse control without reinitializing OpenLayers or Cesium.
- [ ] Run tests and confirm pass.

### Task 4: Create and update the platform iteration log

**Files:**
- Create: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Produces: human-readable development history independent from student behavior logs.

- [ ] Create the process-document header and entry template.
- [ ] Backfill major recent changes: homepage map, orthophoto transparency, homepage structure, course workbench/Supabase, and embedded task rail.
- [ ] Record affected files, database changes, tests, and remaining issues for the current iteration.

### Task 5: Full verification

**Files:**
- Verify all modified runtime and test files.

**Interfaces:**
- Produces: evidence that the integrated workflow works without regressions.

- [ ] Run all feature tests with the bundled Node runtime.
- [ ] Run JavaScript syntax checks.
- [ ] Run the homepage build if homepage source changed.
- [ ] Use the browser to verify homepage → 2D, rail collapse/expand, task switching, 2D/3D switching, and return home.
- [ ] Run `git diff --check` and review the final working-tree diff.

