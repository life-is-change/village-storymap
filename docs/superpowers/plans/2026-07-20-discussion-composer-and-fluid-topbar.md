# Discussion Composer and Fluid Topbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace top bar consume available width naturally, add direct class-message publishing, and remove empty reply placeholders.

**Architecture:** Keep the existing workspace and community-task services. Adjust only the layout contract, render a small composer in the existing message board, and reuse `submitCommunityMessage()` for ordinary messages.

**Tech Stack:** HTML, CSS, browser JavaScript, Node built-in test runner.

## Global Constraints

- Work directly on the current `master` workspace as explicitly authorized.
- Do not commit, push, tag, branch, or create backups.
- Do not change Supabase schema, homepage, or map data.

---

### Task 1: Fluid workspace top bar

**Files:**
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`

- [ ] Add a failing assertion that the space selector grows into remaining width without a fixed maximum.
- [ ] Run the focused test and confirm it fails because the selector is capped.
- [ ] Change the selector to `flex: 1 1 240px` with `max-width: none`, retaining compact minimum widths.
- [ ] Run the focused test and confirm it passes.

### Task 2: Inline class discussion composer

**Files:**
- Modify: `features/ui/space-panel.js`
- Modify: `app.js`
- Modify: `style.css`
- Test: `features/ui/workspace-settings-collaboration.test.js`

- [ ] Add failing assertions for a discussion textarea, publish button, and absence of the duplicate drawer action button.
- [ ] Run the focused test and confirm the composer is missing.
- [ ] Render the composer beneath the discussion title and bind publish to `submitCommunityMessage({ category: null, ... })`.
- [ ] Make both top entry and drawer navigation focus the composer.
- [ ] Run the focused test and confirm it passes.

### Task 3: Empty reply area collapse

**Files:**
- Modify: `app.js`
- Modify: `style.css`
- Test: `features/ui/community-message-visual.test.js`

- [ ] Add a failing assertion for an explicit empty/open reply state.
- [ ] Run the focused test and confirm the state handling is missing.
- [ ] Hide reply containers with no replies; reveal them on reply action and retain them after the first reply.
- [ ] Run the focused test and confirm it passes.

### Task 4: Verification and iteration log

**Files:**
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

- [ ] Run `node --check app.js`.
- [ ] Run all repository Node tests.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Record the verified changes in the iteration log without committing them.

### Task 5: Container-aware three-tier top bar

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`

- [ ] Add failing assertions for a named inline-size container, two container-query tiers, and removal of panel-state/page-width text hiding.
- [ ] Run the focused test and confirm the current hard-coded rules fail the assertions.
- [ ] Add icons and text spans to the discussion action, then implement wide, medium, and narrow container-query layouts.
- [ ] Run the focused test and the full repository suite.

### Task 6: Four-state semantic top bar

**Files:**
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Consumes: existing `course-task-expanded`, `mode-map-left-collapsed`, and `mode-map-right-collapsed` layout classes.
- Produces: state-specific CSS variables for identity visibility, selector maximum width, and action-label visibility; container queries remain the overflow fallback.

- [x] Add failing assertions for left-open/right-closed, left-closed/right-open, both-open, and both-collapsed selectors.
- [x] Run `node --test features/ui/workspace-responsive-layout.test.js` and confirm the assertions fail because only width tiers exist.
- [x] Introduce state-specific CSS variables: hide duplicated identity for left-open states, cap the selector per state, and use icon actions when both panels are open.
- [x] Keep the `850px` and `620px` container queries as fallback overrides instead of the primary semantic layout.
- [x] Run the focused test, all repository Node tests, `node --check app.js`, and `git diff --check`.
- [x] Record the four-state top-bar refinement in `docs/PLATFORM_ITERATION_LOG.md` without committing, tagging, branching, or creating a backup.

### Task 7: Priority grid for boundary-safe top-bar controls

**Files:**
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Consumes: the six existing direct children of `.workspace-context-bar` and the four side-panel state selectors from Task 6.
- Produces: `--workspace-grid-columns` per state, a `minmax(160px, 1fr)` selector track, and staged settings/discussion label collapse.

- [x] Add failing assertions for grid display, six-slot and five-slot state templates, removal of selector caps/automatic margin, staged label breakpoints, and 14px right padding.
- [x] Run `node --test features/ui/workspace-responsive-layout.test.js`; confirm failure because the bar still uses Flex and automatic margin.
- [x] Change the active bar to CSS Grid, make the selector occupy the flexible track, and remove its fixed state caps and discussion auto margin.
- [x] Add an earlier container tier that collapses only the settings label, while the existing narrower tier collapses discussion as well.
- [x] Run focused and full tests, `node --check app.js`, and `git diff --check`.
- [x] Update the iteration log and leave all files uncommitted on `master`.

### Task 8: Move the home action into the workspace top bar

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Consumes: the existing `floatingHomeBtn` click binding and the priority-grid top bar from Task 7.
- Produces: a fixed first home-action track followed by the existing identity, selector, space actions, view switch, discussion, and settings tracks.

- [x] Add a failing structural test asserting that `floatingHomeBtn` is inside `workspaceContextBar`, precedes the identity block, and is absent from `courseContextPanel`.
- [x] Run `node --test features/ui/workspace-responsive-layout.test.js`; confirm failure while the button remains in the left course header.
- [x] Move the existing button markup into the top bar and add the fixed home-action column to every semantic grid template.
- [x] Remove obsolete left-header button sizing and keep the existing click binding unchanged.
- [x] Run focused and full tests, `node --check app.js`, and `git diff --check`.
- [x] Record the home-button relocation in the iteration log and leave the work uncommitted on `master`.
