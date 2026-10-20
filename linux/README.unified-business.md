# Unified Aliyun candidate

This replaces the repeated per-module candidate process with one release image, one private state directory and one consolidated acceptance pass. Development still follows local `main` → tests → GitHub → Aliyun `git pull --ff-only`. Source `deployment-config.js` remains Supabase; only the Aliyun image's static copy uses the local API.

**Current status:** candidate deployment tooling, not a production migration completion. Do not upload the intermediate `689de9d` image. A final archive with matching native/Platform CI proof will be recorded after deployment/activation tooling and whole-change review. The old 2026-10-15 database snapshot is suitable for development validation only; it cannot authorize activation.

After that final archive and a new verified snapshot are available, upload the image without unpacking, alongside the snapshot's four verified files and manifest in a private directory outside the website/repository. From `~/village-deploy/source`, the candidate command is:

```bash
git pull --ff-only origin main &&
python3 linux/scripts/deploy-unified-business.py --deploy \
  --archive "$HOME/village-db-backups/FRESH_SNAPSHOT/FINAL_UNIFIED_IMAGE.tar.gz" \
  --backup-dir "$HOME/village-db-backups/FRESH_SNAPSHOT"
```

`FINAL_UNIFIED_IMAGE.tar.gz` must be exactly the filename, byte size and SHA256 in `linux/unified-release.json`. These placeholders are not current upload instructions. The final handoff will provide concrete paths. The script prompts once for the server Secret key if files still need copying, then once for each website admin/member login password. Database credentials are generated locally into a private file. Nothing secret belongs in command arguments, chat, Git or browser configuration.

The command checks the accepted old candidate layout and shared PG identity/HBA, loads the verified image, extracts immutable web/schema copies, creates only `village_unified_candidate` and `village_unified_login`, restores in one transaction, verifies snapshot table/sequence counts and extensions, installs the exact local schemas, copies referenced ordinary files, and starts `village-unified-api` on loopback18084 plus a same-origin Nginx preview on loopback18085. It does not stop/restart the shared PG, old candidates or public Nginx80. There is one four-connection pool, API256MiB, preview64MiB, existing PG768MiB. It requires512MiB available RAM and4GiB free disk; passing these minimums is not a class-size capacity guarantee.

The consolidated TEST pass covers ordinary geometry/attributes/private photo/model, scene asset publishing/document/save/milestone, immutable byte read-back, per-instance synthetic task evidence and1/5/10/20-worker measurements. It restarts the actual API container and checks the same container ID with a changed `StartedAt`, then rereads document/version/file. It never submits a real GPU/provider job. Successful output is `UNIFIED_INTERNAL_VALIDATED_NOT_CUT_OVER`.

On interruption, preserve all private state/logs and rerun the same command with `--resume` replacing `--deploy`. Completed restore/schema steps are not replayed. Pending steps need exact external proof; an ambiguous database/schema/partial extraction stops for inspection rather than resetting a volume. File-copy receipts support idempotent object transfer; missing/changed source objects never count as verified. `--check` performs preflight without loading images or creating state. `--verify --state-dir ...` rechecks and restarts only the new API; website login/file acceptance still requires the probe. `--rollback-code` stops only the new candidate API/preview and retains every database/file. It does not route users back across independent datasets.

Private state is `~/village-unified-deploy`. Its deployment receipts bind archive/snapshot hashes, database OID/comment nonce, original PG/web container IDs/start times, HBA, image IDs and schema fingerprint. Unknown container, resource, HBA, execution command, environment, mount or network changes stop the operation. Failed commands retain private errors. Send only the sanitized `STOP` line, never SQL/log contents or credentials.

The API bridge starts disabled. A readiness heartbeat must come from running compatible Worker code (`geo-aliyun-bridge-v1` / `facade-aliyun-bridge-v1`) within2minutes; any active old claimant of that kind blocks new private submissions. Source ordinary task endpoints retain their existing behavior. Update the campus4090 checkout to the **same reviewed Git commit** and restart its existing Worker service using its existing environment. Do not replace its service name or credentials based on guesses. If rollback is necessary, first disable new Aliyun bridge submissions and drain/cancel in-flight work before restarting old Worker code; retain task/file receipts. Aliyun cannot directly administer a campus GPU through a database copy.

Public activation is a separate guarded action: new snapshot/file consistency, HTTPS domain/certificate, installed private source bridge and compatible live Workers are required. A plain public IP/HTTP site cannot pass the public-token gate. GitHub Pages remains writable on Supabase; new writes at the two sites are independent and are not merged automatically. See [acceptance matrix](../docs/migration/unified-acceptance-matrix.md).
