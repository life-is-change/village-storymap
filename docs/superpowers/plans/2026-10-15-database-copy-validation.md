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
- [ ] Execute on Aliyun after the user enters the database password locally. This is pending authenticated terminal access; browser Workbench access previously failed its permission check and must not be bypassed.

## Task 2: Isolated restore validation

- [ ] Inspect actual archive/roles and compatibility before generating a restore operation.
- [ ] Use the verified official image `supabase/postgres:17.6.1.136` (from self-hosted/v0.8.2), an internal Docker network and no published database port. Verify image availability first.
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
