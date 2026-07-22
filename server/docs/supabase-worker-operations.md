# Supabase worker deployment

The browser uses the existing publishable key. The service-role key must exist
only in `server/.env` on the Worker computer; never paste it into source code,
browser storage, screenshots, issues, or chat.

## One-time cloud setup

1. In the signed-in Supabase SQL Editor, apply the existing auth/profile
   migration if it has not already been applied.
2. Apply `supabase_SQL/Geoprocessing Worker Queue.sql`.
3. Apply the updated course workbench seed if the remote course was previously
   created.
4. Confirm Storage bucket `geoprocessing-results` exists and is **private**.
5. Confirm the API exposes the queue RPCs and Realtime includes
   `public.geoprocessing_runs`.

The migration is idempotent. Do not run it from the browser with the
publishable key.

## Win11 Worker configuration

Copy `server/.env.example` to the ignored `server/.env` and replace only the
local values. Verify before adding credentials:

```powershell
git check-ignore server/.env
```

Then run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing health --local
server\scripts\start_platform_worker.ps1
server\scripts\stop_platform_worker.ps1
```

The Worker initiates outbound HTTPS to Supabase. Do not add an inbound Windows
Firewall rule. The model service remains on `127.0.0.1:8021`.

## Live contract verification

After migration and local `.env` are ready, explicitly opt in:

```powershell
$env:RUN_LIVE_SUPABASE='1'
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest `
  server\tests\integration\test_live_queue.py -m live_supabase -v
```

If a Worker is busy, pause new claims with the teacher/admin RPC rather than
terminating a GPU process mid-stage. Lease expiry allows another Worker to
recover a task after a crash, up to three attempts.
