# Autonomous task files: implementation and acceptance boundary

The new local Worker file protocol uses the same private blob store and ownership domain as ordinary uploads. It never accepts a source URL or writes back to Supabase. Existing source deployments do not enable these routes.

- A leased photo retains its exact local file UUID, SHA-256, size and MIME. Reads support byte ranges and close their file handles on completion or disconnect.
- Results use ordered 8 MiB chunks with SHA-256 and durable receipts. Chunk files are immutable; interruptions and lost acknowledgements can be retried after restart.
- Final publication requires a full streamed digest and format check, atomic private-store persistence, then another transaction checking credential, lease, phase, cancellation and current ownership. A stale Worker cannot publish a result even if its bytes already reached disk.
- GeoJSON results support up to 512 MiB; model results remain at 50 MiB and images at 10 MiB. Ordinary browser upload limits are unchanged. New chunks stop when fewer than 2 GiB would remain free.
- The outbox adopts an already verified result blob rather than copying it again. Import remains idempotent and checks the destination space's current permissions.

Local unit coverage includes a real 51 MiB supported GeoJSON, interrupted and wrong-digest chunks, restart adoption, file budgets and ranged HTTP reads. Disposable native CI additionally exercises the database receipts, lease expiry, private photo input, rectification/crop/generation transitions and result import. Native results must be recorded before this task is accepted.

This is not cloud deployment or a real GPU acceptance record. The unified release still needs the Worker adapter, provider handling, fresh snapshot, IP HTTPS, coordinated switch and actual browser/GPU checks. Old archives and the old handoff must not be used for that switch. The release maintenance step must clean expired unreferenced chunk sessions without deleting referenced blobs; failed final commits retain private data for diagnosis.
