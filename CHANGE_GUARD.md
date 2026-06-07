# Change Guard (For Future Tasks)

## Fixed Boundaries
- Primary entry is fixed: `/index.html`
- High-risk files (require explicit confirmation before modifying):
1. `/index.html`
2. `/app.js` (homepage bridge + view switching)
3. `/style.css` (layout and visibility behavior)

## Default Safe Scope
- If task is about 3D generator integration, prefer edits in:
1. `/app-3d.js`
2. `/rural_house_generator/*`
- Do not touch entry chain unless user explicitly asks.

## Mandatory Pre-Change Summary (assistant must output first)
1. Confirmed main entry file
2. Files to be changed in this task
3. Files guaranteed not to be changed

## Mandatory Post-Change Regression Checks
1. Homepage identity flow works: login / register / logout
2. Homepage "Enter Platform" jumps into integrated platform correctly
3. 2D and 3D views still switch normally
4. New feature path works (for this project: 3D generator integration)

## Reusable Prompt Template
Use this at the start of each new request:

```text
Follow ENTRYPOINTS.md and CHANGE_GUARD.md in project root.
Primary entry is fixed at /index.html.
Allowed edit scope this time: [fill allowed files/dirs].
Do not modify: [fill protected files, e.g. index.html, app.js, style.css].
Before editing, first send 3 lines:
1) confirmed entry file
2) files to change
3) files guaranteed unchanged
After changes, run and report the regression checklist from CHANGE_GUARD.md.
```
