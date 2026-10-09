# Platform performance pass (approved 2026-10-08)
Spec: user's nine bottlenecks and approval “可以，另外其他能优化的可以一起优化一下”.
Goal: reduce blocking work without changing permissions, editing semantics, entry layout, database or GPU production.
Baseline: main 34d2dff; 841 JavaScript tests pass.

## Tasks and completion gates
1. Layer switches: retain rendered layer geometry only for current space; hide immediately; do not refetch initialized empty layers; force rebuild must invalidate retained data. Regression tests first, then implementation; run overlay and space-panel tests.
2. 3D: locate village from current georeference before network restoration; bounded parallel model restores, preserving edits before bindings and stale-space protection. Regressions first; run 3D and integration tests.
3. Rendering: balanced inset quality and suspend hidden rendering, without discarding models; capped resolution and configurable texture/model visibility where safe. Regression tests first; run reality tests.
4. Data/startup: deduplicate public static dataset reads, bound cache and prevent stale village writes; parallel independent scene catalog/version reads. Preserve startup failure reporting and full readiness. Regression tests first; run startup, village, scene tests.
5. Verification: full suite, actual local browser entry/layer/2D/3D/studio/village runs; distinguish network timings from controlled tests; no invented speedups; fresh whole-branch reviewer and fix relevant findings.

## Interfaces / review focus
Layer style visibility and overlay cache must agree; active feature selection must not retain hidden items. Dataset cache must be keyed by actual resource identity, not layer name, and must never reuse private data across accounts. Model concurrency must retain same-object precedence and not write results into a switched space. No auth bypass. Do not change index.html, style.css, worker files, cloud schema, release settings or deploy.
Expected: focused and full Node tests green. Real browser speed claims require repeated actual measurements; if blocked, state the blocker and provide reproducible measurement artifacts.
