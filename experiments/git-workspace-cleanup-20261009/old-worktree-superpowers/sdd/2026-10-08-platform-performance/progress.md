# Performance ledger

Base: main 34d2dff161f67455133fb3ae32f545ce5ddeb747. Baseline 841/841 tests passed.

- Task 1: Layer visibility retains source-scoped rendered snapshots, skips cloud reads only for visibility-only reuse, and invalidates on forced refresh. Regression tests failed before implementation and passed afterwards. A failed refresh now rejects once instead of retrying automatically; later requests can retry.
- Task 2: Village camera positions before remote terrain/model restoration. Edited and textured models restore with three concurrent independent object groups; edits precede bindings, duplicate objects stay sequential, and stale spaces cancel queued work. RED then GREEN.
- Task 3: Reality inset uses balanced default resolution/SSE and pauses rendering while its host is hidden. Sharp mode retains previous settings. RED then GREEN.
- Task 4: Dataset text cache is bounded by 16 entries/32 MiB/5 minutes, scoped by account and dataset identity. Signed token rotation only is normalized. Village/account changes invalidate pending publish. Warm village selection avoids unnecessary personal-space creation RPC; cold missing-space selection may add one list query. Studio seed/assets/version reads start together after correct project resolution. RED then GREEN.
- Task 5: Independent whole-diff reviewer found a background imagery race. Actual A/B async reproduction failed before the fix; viewer/load-generation checks fixed it. Full suite after review: 859 tests, 859 passed, 0 failed (6718 ms). git diff --check passed.

Controlled actual-function benchmark, three rounds: 100 simulated model waits before 1568/1576/1560 ms, after 528/532/532 ms; studio simulated resource waits before 103/93/91 ms, after 52/47/47 ms. This is scheduling evidence, not GPU/network throughput evidence.

Live browser testing uses the user's RTX 4060 Laptop GPU and existing signed-in account at localhost:9010. A ~74-second initial identity request is excluded from typical before/after claims. Baseline and after samples are collected separately; final report must disclose real sample ranges, warm/cold distinction, unchanged external network waits, and no real 100-building GPU/FPS benchmark.

Scope: no root index.html/style.css, auth/permissions changes, database migration, cloud deployment, Pages publishing or 4090 Worker changes. True model/texture LOD requires generated assets and is not implemented in this pass.

Final RTX 4060 live comparison (3 valid rounds each): layer restore median 713 -> 2 ms (function completion, not full paint); warm 3D 2386 -> 944 ms; studio 9653 -> 3792 ms. Network varies; no causal FPS or cold-start claim. After village switches 5688/3837 ms, only one sample each. Failed remote-account/village long-tail samples excluded from typical medians but disclosed. Old-script-cache after-v1/v2 excluded; valid after-v3 verified fresh handler/cache.

Delivered to original main working directory without commit/push/deployment. Final original suite 859/859, 0 failed (5468 ms); diff check clean; root index/style unchanged; all 24 delivered source/test/plan/controlled files match worktree by SHA-256. Live model and roads loaded; warm enter preserves prior view, reset view visibly restores building overview. Screenshot and detailed report saved.
