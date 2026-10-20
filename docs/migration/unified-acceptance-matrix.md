# Unified candidate acceptance

This matrix describes evidence, not a production cutover. The checked-in website configuration remains `source`. No real GPU task or billable provider submission is part of automated acceptance.

| Area | Automated evidence | Real cloud gate |
| --- | --- | --- |
| Ordinary identity/course/admin | Native PostGIS identity/catalog permissions, receipt replay, inactive-profile refusal; shared HTTP pool | One admin and one existing member hidden login |
| Survey/community/planning | Native scoped reads/writes, owner checks, leases, revision conflicts, baseline/freeze and history | Dedicated TEST context read/write after fresh snapshot |
| Models/private files | Native hash validation, reference retention, foreign-user denial, shared read/write budgets; browser reauthorization | Uploaded TEST bytes and existing snapshot files verified |
| 3D document/assets/milestone | Actual studio unit flow, native C2a shared-pool HTTP, atomic preview/version protocol | Consolidated GLB/preview/save/version and Docker restart read-back |
| 4090/provider bridge | Native per-instance receipts/tombstones/outbox/import; existing Worker gateway tests; both Edge functions Deno typechecked | Source SQL/Edge deployment and compatible Worker readiness; real generation explicitly untested |
| Website assembly | Fresh Chromium loads real `index.html` and `admin.html` in both modes; no page exceptions; Aliyun ordinary calls never reach source SDK | Actual Aliyun HTTPS browser flow before activation |
| Capacity | Native HTTP load 1/5/10/20 workers, three samples per worker, four-connection upper bound | Same cloud load with real Auth latency, host available memory, API/PG limits and restart evidence |
| Source compatibility | Frontend regression and source browser assembly retain original SDK adapters | GitHub Pages remains source; independent writable datasets are intentional |

`tools/unified-tests/browser-flow.mjs` uses synthetic Auth and synthetic API responses and blocks every external browser request except a locally supplied SDK stub. It proves actual page script assembly and routing, not Supabase availability, map tile availability, visual model rendering or production authorization.

`unified-acceptance.integration.mjs` uses a disposable native PostGIS cluster in GitHub Actions. It records end-to-end P50/P95 and Auth/SQL/file-stage P95. Its Auth verifier is synthetic; it cannot measure Tokyo Auth latency. Its restart is a new HTTP service/shared pool against the same test database, not a Docker restart. The final cloud probe requires the actual container ID to remain unchanged and `StartedAt` to change, followed by document/version/file read-back.

`Server-Timing` reports Auth verification, complete SQL transaction time (including pool acquisition), and private file store open/stage/close time. Headers contain measurements completed when headers are sent; streaming body transfer is included only in the end-to-end client time. These stages are diagnostic, not a claim that all latency is additive. Structured logs contain only generated request IDs, fixed action names, HTTP status and numeric times; no tokens, SQL, names or rows.

The consolidated probe persists only TEST IDs, run/release/instance bindings, receipt IDs and digests in private state. A failed phase clears `complete`; reruns reuse deterministic upload/write receipts. It refuses all GPU/provider submission operations. Teacher authorization is exercised with a synthetic native identity; real teacher login is not claimed.

Not yet measured: real Aliyun capacity, source-versus-Aliyun equivalent workload latency, HTTPS browser behavior and compatible live Worker readiness. No capacity promise follows from idle container memory. HTTP-only public IP access is insufficient for final activation. Source `managedSpace.delete` is intentionally unavailable in the Aliyun adapter until a separately reviewed local lifecycle operation exists; it must fail visibly rather than fall back to source.

Do not upload an intermediate unified image. The final image and consolidated deployment command are produced after deployment/activation tooling and whole-change review. All cloud acceptance markers must remain `NOT_CUT_OVER` until those gates pass.
