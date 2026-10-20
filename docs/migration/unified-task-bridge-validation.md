# Unified task bridge implementation evidence

Implementation remains isolated from the live source project and Aliyun website.
No real GPU job or paid provider request was submitted during these tests.

At `5f9a9ed`, native PostgreSQL/PostGIS run
[39359623000](https://github.com/life-is-change/village-storymap/actions/runs/39359623000)
and Platform regression
[39359622988](https://github.com/life-is-change/village-storymap/actions/runs/39359622988)
passed. Earlier native run `39359261434` proved the actual private file store and
atomic result import. Local frontend regression passed 1049 tests; API units
passed 81 tests. Worker compatibility and private input validation passed 52 tests.

Covered behavior:

- Transaction rollback creates no outbox entry. A lost source response and a
  restarted dispatcher reuse the same request and remote run.
- Owner, current local profile, membership grant, project, village and space
  are rechecked. Old permission snapshots cannot restore tombstones.
- A cancellation receipt is serialized with source enqueue, including when the
  source request has not arrived. A late delivery cannot recreate that job.
- Local numeric photo IDs never become source photo foreign keys. Same-number
  source photos retain their original locator and submit behavior.
- Private task input uses an immutable instance/file/hash path; outputs remain
  private and require current local permission on every read.
- Actual GeoJSON bytes are validated, hashed and streamed in bounded feature
  batches into one transaction. Repeated import creates one local bundle/version.
  Import receipts include instance, source run, artifact digest and target space.
- Source browser roles, including the same Auth UUID and source administrator,
  cannot read, mutate or sign Aliyun-origin jobs/files. Original source submit,
  cancel, Worker claim and global Auth deletion remain compatible.
- Cloud-provider calls use a separate server-token entry and private lease
  receipts. An uncertain billable submission is retained for reconciliation and
  is never automatically submitted a second time.

Implementation decisions:

- Aliyun cannot currently reach the managed PostgreSQL ports. The new HTTPS Edge
  transport executes fixed RPCs under a dedicated bridge-only database login,
  verified TLS and a single source connection. Credentials stay outside releases.
  The old browser-facing `facade-cloud` entry is unchanged.
- Result files are limited to 50 MiB; a single materialized feature is limited to
  2 MiB. Larger individual geometries fail explicitly rather than exceeding the
  256 MiB API budget. Imports batch at most 500 features and 2 MiB per SQL call.
- Source bridge audit receipts have no Auth-user deletion-blocking foreign key.
  Queue inserts still enforce real Auth UUIDs, and authorization rejects deleted
  identities. Audit origin records continue to protect retained private bytes.

Remaining release gates are whole-page assembly, unified HTTP/resource budgets,
Deno entry/transport checks, unified acceptance, fresh snapshot and HTTPS,
explicit source SQL/Edge installation and compatible Worker readiness. These are
Tasks 12–16; the source SQL is never run by candidate deployment. This document
does not claim production cutover or real provider/GPU acceptance.
