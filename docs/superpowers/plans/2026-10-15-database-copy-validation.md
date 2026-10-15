# Database copy validation implementation plan

**Goal:** Copy the managed PostgreSQL database to private Aliyun backup storage and validate an isolated database restore before any application cutover.

**Approved scope:** The user approved backup and copy validation on the existing 2 GB Aliyun server, retaining managed Supabase. Work remains on the original local `main`, then GitHub, then the server. Existing browser and 4090 connections stay on managed Supabase.

**Architecture:** Native PostgreSQL 17 clients create a consistent custom-format archive, password-free role definitions and a source inventory. Credentials are entered interactively and held in a temporary private pgpass file (POSIX permissions or Windows NTFS ACL). Backup output lives outside all source and web roots. A later restore uses an isolated Supabase-compatible PostgreSQL 17 container, because the source uses PostGIS and Supabase Vault. A plain PostgreSQL container or database-only restore does not provide Auth, Storage APIs or Realtime.

**Tech stack:** Python standard library, official PGDG client packages, Docker Compose for subsequent restore validation.

## Global constraints

- Do not export database contents, credentials or private inventory into Git or the web root.
- Read the source using certificate-verified TLS with the CA from the authenticated dashboard and read-only connection defaults.
- Retain every failed/partial backup; never overwrite or delete source or previous backups.
- Do not change frontend, worker configuration, public ports or production database settings.
- Keep source schemas, table data, sequences, RLS, grants and function definitions in the archive. Role passwords are excluded and will be regenerated on the isolated target.
- Storage object bytes, Auth service settings, API/JWT secrets, Edge Functions and Vault decryption-key availability need separate verification; a SQL archive alone is not a complete Supabase migration.

## Task 1: Private backup tooling

- [x] Test credential escaping, refusal of web/source output directories, failure retention and absence of a success manifest after a failed export.
- [x] Add an Ubuntu 24.04 installer for official PostgreSQL 17 clients only.
- [x] Add interactive backup command with inventory, role export, custom archive, full offline archive decoding and checksums.
- [x] Verify tests, installer Bash syntax and CLI help. Review and prepare the scripts for GitHub `main`.
- [x] Execute the backup on the Windows workstation after the user enters the database password locally. Aliyun-to-source database connections reset before authentication; the workstation is the verified export hop.
- [x] Transfer the verified archive privately to Aliyun. The user uploaded five files manually and all four trusted SHA-256 values matched on the server. Browser Workbench authority remains blocked; no workaround was used.

## Task 2: Isolated restore validation

- [x] Inspect actual archive/roles and compatibility before generating a restore operation. Source roles and preinstalled schema conflicts still require an explicit target restoration strategy; this audit does not establish restore success.
- [x] Obtain the verified official image `supabase/postgres:17.6.1.136` (from self-hosted/v0.8.2). The user imported the offline archive and verified Linux/amd64 and PostgreSQL 17.6.
- [x] Implement and locally test fail-closed restore tooling for a fresh target, private credentials, archive snapshot counts, SQL errors and isolation. Actual cloud execution remains pending.
- [ ] Restore to a fresh destination; stop on SQL errors, retain partial target and backups, never reset an existing target.
- [ ] Compare schema objects, constraints, RLS/grants, functions, sequence state and snapshot table contents, including Auth and Storage metadata.
- [ ] Check actual memory use and recovery from container restart. No frontend/worker cutover follows automatically.

## Ledger

- 2026-10-15: Read-only source audit: PostgreSQL 17.6, database 48 MB, public tables 57, Auth users 4, Storage objects 137, metadata size 22,480,189 bytes. These are observations, not a frozen dump snapshot.
- Ruling: Start with native client backup to avoid making backup depend on previously unreliable Docker registry access. Do not silently downgrade certificate verification or copy Vault secrets as plaintext.
- Ruling: The first executable handoff obtains and validates the backup. Restore must inspect the actual output before claiming a complete copy; managed platform internal objects can conflict with preinitialised self-hosted schemas.
- 2026-10-15: Independent review found no blocking issues. Added successful checksum/credential-cleanup coverage, missing-Auth-data refusal and atomic success-manifest publication from the review suggestions.
- 2026-10-15: Local verification passed: 23 backup/deployment Python tests, Bash installer syntax, CLI help and 1003 existing frontend tests. Source backup and isolated restore have not run; they need the password entered in the server terminal.
- 2026-10-15: Aliyun source export stopped before inventory; passwordless OpenSSL probes on 5432/6543 also received TCP resets, while HTTPS 443 responded. Dashboard has no IP restriction or banned IP. Root location of reset remains unknown; do not rotate the password or disable certificate checks as a guess.
- Ruling: Use Windows workstation as an export hop, then transfer the archive privately to Aliyun. Verified workstation TLS 1.3 with the dashboard CA, and native EDB PG17 client reached authentication (`no password supplied`). No credentials were transmitted by these probes.
- 2026-10-15: Prepared official EDB PG17.11-5 client files outside the repository after matching the publisher's ZIP checksum. Added Windows entrypoint, NTFS ACL enforcement, bundled public CA and missing-CA refusal; no local database service is installed or started. Backup still awaits interactive password input.
- 2026-10-15: Windows review found a binary-stderr handling issue in the ACL failure path; reproduced it with a failing test and added decoding before password redaction. Actual NTFS ACL output retains administrator/owner rights as well as current user/SYSTEM; documentation reflects that scope.
- 2026-10-15: User completed the Windows export at 03:51 UTC. Archive size 3,091,358 bytes; full offline decoding succeeded. Recomputed all four manifest file hashes successfully. No target database has been restored and Storage object bytes have not been transferred.
- 2026-10-15: Read-only inspection found PostgreSQL 17 / PostGIS / Vault dependencies and managed global role definitions that must not be applied blindly to a preinitialised target. The bootstrap admin must not be demoted by restoring the source postgres role definition.
- 2026-10-15: User steered the application migration toward ordinary business data on Aliyun while retaining Supabase for 4090 task dispatch. See the hybrid migration design draft; the full archive remains a private recovery source, not a cutover operation.
- 2026-10-15: Both Aliyun registry paths failed before image download. Windows downloaded the official pinned amd64 manifest using checksum-verified Google crane v0.22.1; full tar validation and gzip round-trip hashes passed. User uploaded and imported it. The Docker-local ID is the manifest of uncompressed tar layers, not the original image-config hash; reconstructed it locally and corrected tagging. Server reports PostgreSQL 17.6.
- Ruling: For copy validation, use network_mode none instead of an internal Docker network. Only local docker exec manages the copy; this is stricter isolation and avoids any restored code making network calls. A future production API requires a separate network configuration.
- Ruling: Override baked platform initialisation with an empty read-only init directory and native PGDATA configuration. A separate bootstrap admin avoids collisions/demotion when restoring source roles; the target database comes from template0. This preserves the unfiltered archive for isolated validation without claiming compatibility with an already-initialised Supabase stack.
- 2026-10-15: Actual image control files match PostGIS 3.3.7, Vault 0.3.1 and PG17 extension versions. Actual archive parsing found 106 full non-extension COPY blocks, 14 sequence states, 4 auth users and 137 storage metadata objects. Named TOC definitions include 107 tables, 159 indexes, 141 key constraints, one separate CHECK and 164 FKs; 11 table attachments and 22 index attachments are not extra definitions.
- 2026-10-15: Independent review found CHECK/key-constraint count mismatch and possible private values in stderr summaries. Reproduced both with failing tests, corrected SQL category predicates and stopped echoing stderr. Added named-object validation to handle partition-generated objects without false failures; actual cloud initialisation/restoration is still untested.
- 2026-10-15: Final local verification passed 53 linux deployment/backup/restore tests, including 16 restore tests; CLI help and actual private archive parsing passed. Existing Windows ACL tests require unsandboxed synthetic temporary directories, where the full suite passed. Image inspection confirmed the Nix postgres wrapper exports its plugin-library directory. Vault 0.3.1 source confirms non-preloaded loading skips key-script execution; no Vault master key is requested or copied. Cloud startup and restore remain to be executed manually by the user.
- 2026-10-15: User executed the cloud restore. Initialisation, extension compatibility and archive snapshot inspection reached the roles phase, where PostgreSQL 17.6 rejected `GRANTED BY supabase_admin`. The target bootstrap superuser differs from the source bootstrap grantor. No target business database was created; cloud restoration is incomplete.
- Ruling: Preserve the original role archive and generate a private target script that maps only the explicit `supabase_admin` grantor to `village_restore_admin`; keep role definitions, membership recipients and options unchanged. Reject unexpected grantors. Submit the generated script in one psql transaction. Add a guarded `--resume` only for the verified, rolled-back roles checkpoint, with the same image/mounts/isolation and no business database; do not delete, recreate or reset the existing target. Keep earlier error logs.
- 2026-10-15: Five new regression tests first failed for the missing grantor mapping, stdin role transaction, resume guards and log retention, then passed with the fix (21 restore tests). Cloud retry is still pending; no application or 4090 cutover has occurred.
- 2026-10-15: Final fix verification passed all 58 linux tests, CLI help and diff whitespace checks. Private structural inspection confirms all 18 source role grants are mapped and the source role file checksum is unchanged. Independent review approved the controlled retry with no blocking findings. Actual cloud retry remains pending.
