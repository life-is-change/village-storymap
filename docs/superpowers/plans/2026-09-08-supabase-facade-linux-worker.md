# Supabase Facade Linux Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing two-stage photo-facade pipeline through a private Supabase queue and an outbound-only Ubuntu RTX 4090 Worker while preserving student roof-line confirmation and the latest successful GLB.

**Architecture:** Add a dedicated facade queue and private artifact bucket rather than extending `geoprocessing_runs`. A queue-facing `facade-worker` downloads trusted historical photos, reuses the existing facade processing core, communicates with internal-only DINO/SAM2.1 and LaMa services, invokes Blender 3.0.1, and publishes artifacts; the browser uses RPC, Realtime, and signed URLs only.

**Tech Stack:** PostgreSQL/Supabase RLS and Storage, browser JavaScript, Python 3.10/3.11, FastAPI, PyTorch, Grounding DINO Base, SAM 2.1 Large, SimpleLaMa, OpenCV, SciPy, Blender 3.0.1, Docker Compose, pytest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-08-supabase-facade-linux-worker-design.md`

## Global Constraints

- All implementation work runs only in the `codex/facade-linux-worker` worktree; before every commit, `git branch --show-current` must equal `codex/facade-linux-worker`.
- Do not switch the original `learning` worktree, stage its files, or commit implementation files there.
- Reuse the `linux/` deployment skeleton selectively from `codex/linux-4090-deployment`; never merge that branch wholesale into the current codebase.
- Do not commit model weights, Hugging Face caches, Supabase credentials, historical photos, generated artifacts, runtime data, or server `.env` files.
- Keep Blender pinned to 3.0.1 for the first deployment; `BLENDER_EXECUTABLE=/usr/bin/blender` inside `facade-worker`.
- Keep `facade-ml` and `facade-lama` internal-only with no host `ports` mapping.
- Inject `SUPABASE_SERVICE_ROLE_KEY` only into `facade-worker`.
- All three facade services mount the same writable `/work`; model mounts are read-only.
- GPU inference is serialized across GIS and facade workloads through `/work/.locks/gpu-0.lock`.
- Historical photos are referenced by `photo_id`; the browser never submits an arbitrary worker download URL.
- `awaiting_crop` owns no lease and consumes no GPU.
- Regeneration reuses rectification artifacts and replaces the official GLB only after the new revision validates successfully.
- The first real production task is the deployment acceptance run; no separate pre-deployment Blender smoke gate is required.

---

### Task 1: Restore the Linux deployment skeleton into the isolated branch

**Files:**
- Restore: `linux/.env.example`
- Restore: `linux/Dockerfile.building`
- Restore: `linux/Dockerfile.geo`
- Restore: `linux/compose.yaml`
- Restore: `linux/README.md`
- Restore: `linux/scripts/check-host.sh`
- Restore: `linux/scripts/verify-deployment.sh`
- Restore: `linux/systemd/village-platform.service`
- Restore: `linux/tests/test_deployment_contract.py`
- Restore: remaining tracked files under `linux/`

**Interfaces:**
- Consumes: the current branch at design commit `c2a9d30` and the historical tree `codex/linux-4090-deployment:linux/`.
- Produces: a current-branch copy of the previous GIS deployment package without importing old `server/` code.

- [ ] **Step 1: Verify the branch isolation gate**

```powershell
$branch = git branch --show-current
if ($branch -ne 'codex/facade-linux-worker') { throw "Wrong branch: $branch" }
git status --short --branch
```

Expected: the branch is exactly `codex/facade-linux-worker`; the original `learning` worktree is not modified.

- [ ] **Step 2: Restore only the deployment directory**

```powershell
git restore --source codex/linux-4090-deployment -- linux
```

Do not run `git merge codex/linux-4090-deployment` and do not restore `server/` from that branch.

- [ ] **Step 3: Run the restored deployment contract tests**

```powershell
python -m pytest linux/tests/test_deployment_contract.py -q
```

Expected: either PASS, or failures limited to current-tree compatibility assumptions that are corrected in Task 7; no missing `linux/` files.

- [ ] **Step 4: Confirm forbidden assets are absent**

```powershell
git status --short
rg -n "SUPABASE_SERVICE_ROLE_KEY=.*[^<]$|eyJ[A-Za-z0-9_.-]{20,}" linux
git ls-files linux | rg "\.(pth|pt|ckpt|tif|pbf|glb|png|jpg|webp|env)$"
```

Expected: no real credential and no large runtime/model artifact; `.env.example` may contain only obvious placeholders.

- [ ] **Step 5: Commit the isolated skeleton**

```powershell
git branch --show-current
git add linux
git commit -m "build: restore linux worker deployment skeleton"
```

---

### Task 2: Add the secure two-stage Supabase facade queue

**Files:**
- Create: `supabase_SQL/Facade Generation Worker Queue.sql`
- Create: `features/data/facade-generation-security.test.js`
- Modify: `supabase_SQL/README.md`

**Interfaces:**
- Consumes: `public.object_photos`, `public.current_profile_role()`, `auth.uid()`, and Supabase Storage.
- Produces: tables `facade_generation_runs`, `facade_generation_artifacts`; bucket `facade-generation`; RPCs `submit_facade_run`, `claim_next_facade_run`, `renew_facade_run_lease`, `publish_facade_rectification`, `confirm_facade_crop`, `record_facade_artifact`, `set_facade_run_state`, and `request_facade_cancel`.

- [ ] **Step 1: Write the failing SQL security contract test**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase_SQL/Facade Generation Worker Queue.sql', 'utf8');

test('facade queue separates the manual crop pause from claimable states', () => {
  assert.match(sql, /queued_rectification/);
  assert.match(sql, /awaiting_crop/);
  assert.match(sql, /queued_generation/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /status in \('queued_rectification','queued_generation'/i);
});

test('student RPC trusts photo id and worker RPCs require service_role', () => {
  assert.match(sql, /submit_facade_run\([\s\S]*p_photo_id bigint/i);
  assert.match(sql, /object_photos/i);
  assert.doesNotMatch(sql, /submit_facade_run\([\s\S]*p_photo_url/i);
  assert.match(sql, /grant execute on function public\.claim_next_facade_run\(text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.claim_next_facade_run\(text\) from public, anon, authenticated/i);
});

test('private facade artifacts are owner scoped', () => {
  assert.match(sql, /insert into storage\.buckets[\s\S]*facade-generation[\s\S]*false/i);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\]=auth\.uid\(\)::text/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.facade_generation_runs/i);
});
```

- [ ] **Step 2: Run the test and verify the schema is missing**

```powershell
node --test features/data/facade-generation-security.test.js
```

Expected: FAIL because `Facade Generation Worker Queue.sql` does not exist.

- [ ] **Step 3: Implement the exact tables and status constraint**

Create `facade_generation_runs` with at least these typed columns:

```sql
id uuid primary key default gen_random_uuid(),
owner_id uuid not null references auth.users(id) on delete cascade,
course_id text not null,
space_id text not null,
object_code text not null,
photo_id bigint not null references public.object_photos(id),
status text not null default 'queued_rectification' check (status in (
  'queued_rectification','claimed_rectification','rectifying','awaiting_crop',
  'queued_generation','claimed_generation','generating','completed',
  'failed','cancel_requested','canceled'
)),
crop_top double precision check (crop_top between 0 and 0.65),
roof_type text check (roof_type in ('hip','gable','flat')),
building_width double precision check (building_width > 0 and building_width <= 500),
building_depth double precision check (building_depth > 0 and building_depth <= 500),
generation_revision integer not null default 0 check (generation_revision >= 0),
progress smallint not null default 0 check (progress between 0 and 100),
current_stage text,
worker_id text,
lease_expires_at timestamptz,
attempt_count integer not null default 0,
error_code text,
error_message text,
created_at timestamptz not null default now(),
started_at timestamptz,
completed_at timestamptz,
updated_at timestamptz not null default now()
```

Create `facade_generation_artifacts` with primary key `(run_id, artifact_type)`, plus `storage_path`, `content_type`, `size_bytes`, `sha256`, `generation_revision`, `source jsonb`, and `created_at`.

- [ ] **Step 4: Implement student-facing RPC validation**

`submit_facade_run` must:

```sql
select object_code, object_type into v_object_code, v_object_type
from public.object_photos where id = p_photo_id;
if not found then raise exception 'PHOTO_NOT_FOUND'; end if;
if v_object_code <> p_object_code or v_object_type <> 'building'
then raise exception 'PHOTO_BUILDING_MISMATCH'; end if;
```

It derives `owner_id` from `auth.uid()`, permits at most two active facade runs per owner, and returns the new UUID.

`confirm_facade_crop` must allow the owner to transition only from `awaiting_crop` or `completed`, validate `crop_top`, dimensions, and roof type, increment `generation_revision`, clear current errors, preserve the prior successful artifact record, and set `queued_generation`.

- [ ] **Step 5: Implement worker lease and atomic publication RPCs**

`claim_next_facade_run` must claim only `queued_rectification`, `queued_generation`, or expired `claimed_*`/running rows; use `FOR UPDATE SKIP LOCKED`; set the stage-specific claimed state; increment attempts; and set a 90-second lease.

`publish_facade_rectification` must verify `worker_id`, record required rectification artifacts, set `awaiting_crop`, and clear the lease in one transaction.

`set_facade_run_state` must reject arbitrary statuses and permit only worker-owned transitions to `rectifying`, `generating`, `completed`, `failed`, or `canceled`.

- [ ] **Step 6: Add RLS, grants, Storage policies, and Realtime**

Use owner-or-teacher read policies. Revoke table inserts/updates/deletes from browser roles. Grant student RPCs to `authenticated`, worker RPCs only to `service_role`, and create a private `facade-generation` bucket whose first path component must equal `auth.uid()` for authenticated reads.

- [ ] **Step 7: Run SQL contract tests**

```powershell
node --test features/data/facade-generation-security.test.js features/data/geoprocessing-queue-security.test.js
```

Expected: PASS for the new facade contracts and no regression in the GIS queue.

- [ ] **Step 8: Commit the schema**

```powershell
git branch --show-current
git add 'supabase_SQL/Facade Generation Worker Queue.sql' supabase_SQL/README.md features/data/facade-generation-security.test.js
git commit -m "feat: add secure facade generation queue"
```

---

### Task 3: Add typed facade queue models and the Supabase gateway

**Files:**
- Create: `server/src/village_processing/facade/__init__.py`
- Create: `server/src/village_processing/facade/models.py`
- Create: `server/src/village_processing/facade/gateway.py`
- Create: `server/tests/test_facade_gateway.py`

**Interfaces:**
- Consumes: Supabase Python client RPC and Storage APIs.
- Produces: `FacadeRun.from_row(row)`, `FacadeGateway.claim()`, `download_photo()`, `download_artifact()`, `upload_artifact()`, `publish_rectification()`, `complete_generation()`, `fail()`, `renew()`, and `heartbeat()`.

- [ ] **Step 1: Write failing model and gateway tests**

```python
def test_facade_run_preserves_stage_and_revision():
    run = FacadeRun.from_row({
        "id": "run-1", "owner_id": "user-1", "photo_id": 4,
        "object_code": "B-1", "space_id": "current",
        "status": "queued_generation", "generation_revision": 2,
        "crop_top": 0.18, "roof_type": "gable",
        "building_width": 10, "building_depth": 8,
    })
    assert run.phase == "generation"
    assert run.generation_revision == 2

def test_gateway_claims_from_facade_rpc(fake_supabase):
    fake_supabase.rpc_results["claim_next_facade_run"] = [{
        "id": "run-1", "owner_id": "user-1", "photo_id": 4,
        "object_code": "B-1", "space_id": "current",
        "status": "claimed_rectification", "generation_revision": 0,
    }]
    assert FacadeGateway(fake_supabase).claim("linux-4090-01").phase == "rectification"
```

Also assert MIME-specific upload options, deterministic paths, trusted `house-photos` downloads, legacy URL fallback only from the database row, and POSIX/Windows path redaction.

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m pytest server/tests/test_facade_gateway.py -q
```

Expected: FAIL because `village_processing.facade` does not exist.

- [ ] **Step 3: Implement the immutable run model**

```python
@dataclass(frozen=True)
class FacadeRun:
    run_id: str
    owner_id: str
    photo_id: int
    object_code: str
    space_id: str
    status: str
    generation_revision: int
    crop_top: float | None = None
    roof_type: str | None = None
    building_width: float | None = None
    building_depth: float | None = None

    @property
    def phase(self) -> str:
        if "rectification" in self.status:
            return "rectification"
        if "generation" in self.status:
            return "generation"
        raise ValueError(f"UNCLAIMABLE_FACADE_STATUS:{self.status}")
```

- [ ] **Step 4: Implement deterministic Storage boundaries**

Use:

```python
BUCKET = "facade-generation"
PHOTO_BUCKET = "house-photos"

def artifact_path(run: FacadeRun, phase: str, filename: str) -> str:
    return f"{run.owner_id}/{run.run_id}/{phase}/{filename}"
```

`download_photo()` first downloads `photo_path`; if it is empty, it may fetch the database-supplied `photo_url` with a bounded timeout and JPEG/PNG content check. It must never accept a URL from the claimed task row or browser parameters.

- [ ] **Step 5: Implement RPC state methods**

Map each method to the exact RPC names from Task 2. `fail()` passes only `safe_message()` output. `upload_artifact()` computes SHA-256 and records content type and size after Storage upload succeeds.

- [ ] **Step 6: Run targeted and existing gateway tests**

```powershell
python -m pytest server/tests/test_facade_gateway.py server/tests/test_supabase_gateway.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit the facade gateway**

```powershell
git branch --show-current
git add server/src/village_processing/facade server/tests/test_facade_gateway.py
git commit -m "feat: add facade queue gateway"
```

---

### Task 4: Extract a reusable two-stage facade processor

**Files:**
- Create: `rural_house_generator/backend/app/facade/job_processor.py`
- Create: `rural_house_generator/backend/tests/test_facade_job_processor.py`
- Modify: `rural_house_generator/backend/app/main.py`

**Interfaces:**
- Consumes: `FullLocalFacadeRectifier`, `crop_facade_body`, `BlenderService`, an input image path, work directory, and validated building parameters.
- Produces: `RectificationArtifacts`, `GenerationArtifacts`, `FacadeJobProcessor.rectify()`, and `FacadeJobProcessor.generate()` usable without FastAPI or Supabase.

- [ ] **Step 1: Write failing processor tests using fakes**

```python
def test_rectify_writes_worker_artifacts_without_fastapi(tmp_path):
    processor = FacadeJobProcessor(rectifier=FakeRectifier(), blender=FakeBlender())
    result = processor.rectify(tmp_path / "input.jpg", tmp_path / "job")
    assert result.source.name == "rectified_source.png"
    assert result.preview.name == "rectified_preview.jpg"
    assert result.building_mask.name == "building_mask_rectified.png"
    assert result.diagnostics.name == "rectification_diagnostics.json"

def test_generate_reuses_rectification_and_validates_glb(tmp_path):
    processor = FacadeJobProcessor(rectifier=FakeRectifier(), blender=FakeBlender())
    result = processor.generate(
        tmp_path / "rectified_source.png", tmp_path / "building_mask_rectified.png",
        tmp_path / "job", crop_top=0.18,
        building={"width": 10, "depth": 8, "wall_height": 6, "roof_height": 1.08, "roof_type": "gable"},
    )
    assert result.glb.read_bytes()[:4] == b"glTF"
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m pytest rural_house_generator/backend/tests/test_facade_job_processor.py -q
```

Expected: FAIL because `job_processor.py` does not exist.

- [ ] **Step 3: Implement focused result types and methods**

```python
@dataclass(frozen=True)
class RectificationArtifacts:
    source: Path
    preview: Path
    building_mask: Path
    diagnostics: Path

@dataclass(frozen=True)
class GenerationArtifacts:
    texture: Path
    glb: Path
    manifest: Path
    building: dict[str, object]

class FacadeJobProcessor:
    def rectify(self, source_path: Path, job_dir: Path) -> RectificationArtifacts: ...
    def generate(
        self, rectified_path: Path, mask_path: Path | None, job_dir: Path,
        crop_top: float, building: dict[str, object],
    ) -> GenerationArtifacts: ...
```

Move duplicated image-writing, preview-sizing, mask lookup, proportional wall-height calculation, texture generation, and GLB validation from the FastAPI handlers into these methods. Keep HTTP status mapping in `main.py`.

- [ ] **Step 4: Preserve the local API through delegation**

Construct one `FacadeJobProcessor` in `create_app()` and have `/rectify`, `/prepare-direct`, and `/generate` delegate to it while preserving existing JSON fields and artifact filenames.

- [ ] **Step 5: Run processor and local API regression tests**

```powershell
python -m pytest rural_house_generator/backend/tests/test_facade_job_processor.py rural_house_generator/backend/tests/test_rectify_api.py rural_house_generator/backend/tests/test_direct_prepare.py rural_house_generator/backend/tests/test_generate_api.py -q
```

Expected: PASS. Real-Blender tests may skip only when the configured executable is absent; fake processor tests must pass.

- [ ] **Step 6: Commit the reusable processor**

```powershell
git branch --show-current
git add rural_house_generator/backend/app/facade/job_processor.py rural_house_generator/backend/app/main.py rural_house_generator/backend/tests/test_facade_job_processor.py
git commit -m "refactor: expose reusable facade job processor"
```

---

### Task 5: Implement the two-stage outbound Facade Worker

**Files:**
- Create: `server/src/village_processing/facade/pipeline.py`
- Create: `server/src/village_processing/facade/worker.py`
- Create: `server/tests/test_facade_worker.py`

**Interfaces:**
- Consumes: `FacadeGateway`, `FacadeJobProcessor`, `FacadeRun`, `/work`, and worker ID.
- Produces: `FacadePipeline.rectify(run)`, `FacadePipeline.generate(run)`, `FacadeWorker.run_once()`, lease renewal, cancellation, and recoverable deterministic work directories.

- [ ] **Step 1: Write failing two-stage worker tests**

Cover these exact cases:

```python
async def test_rectification_uploads_required_artifacts_then_waits_for_crop(): ...
async def test_awaiting_crop_is_never_claimed_or_renewed(): ...
async def test_generation_restores_missing_rectification_artifacts(): ...
async def test_regeneration_failure_preserves_previous_glb_record(): ...
async def test_expired_claim_can_resume_with_deterministic_paths(): ...
async def test_cancel_requested_stops_before_blender(): ...
```

The rectification assertion must end with `gateway.publish_rectification(...)`, not `gateway.complete_generation(...)`.

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m pytest server/tests/test_facade_worker.py -q
```

Expected: FAIL because the facade pipeline and worker do not exist.

- [ ] **Step 3: Implement deterministic work paths and phase dispatch**

```python
class FacadePipeline:
    def work_dir(self, run: FacadeRun) -> Path:
        return self.work_root / "facade-runs" / run.run_id

    def execute(self, run: FacadeRun):
        if run.phase == "rectification":
            return self.rectify(run)
        return self.generate(run)
```

Rectification downloads the photo, invokes `FacadeJobProcessor.rectify`, uploads all required artifacts, and atomically publishes `awaiting_crop`. Generation restores `rectified_source.png` and the mask from Storage if local files are absent, invokes `generate`, uploads a revision-scoped temporary GLB, validates it, then updates the official artifact record and completes the task.

- [ ] **Step 4: Implement lease renewal and cancellation**

Mirror the existing `Worker` renewal task, but call phase-specific facade gateway methods. Start renewal only after a claim. Always cancel and await the renewal coroutine in `finally`. Check cancellation before model inference, before Blender, and before publication.

- [ ] **Step 5: Run worker tests**

```powershell
python -m pytest server/tests/test_facade_worker.py server/tests/test_worker.py -q
```

Expected: PASS with the existing GIS Worker unchanged.

- [ ] **Step 6: Commit the worker**

```powershell
git branch --show-current
git add server/src/village_processing/facade server/tests/test_facade_worker.py
git commit -m "feat: add two-stage facade worker"
```

---

### Task 6: Add a crash-safe shared GPU lock

**Files:**
- Create: `server/src/village_processing/gpu_lock.py`
- Create: `server/tests/test_gpu_lock.py`
- Modify: `server/src/village_processing/building/engine.py`
- Modify: `rural_house_generator/backend/ml_worker.py`

**Interfaces:**
- Consumes: lock file path from `PLATFORM_GPU_LOCK_PATH`, default `/work/.locks/gpu-0.lock` on Linux.
- Produces: `gpu_lock(path: Path, timeout_seconds: float)` context manager used immediately around CUDA inference.

- [ ] **Step 1: Write failing lock tests**

```python
def test_gpu_lock_serializes_two_processes(tmp_path): ...
def test_gpu_lock_timeout_raises_stable_code(tmp_path): ...
def test_gpu_lock_is_released_when_holder_process_exits(tmp_path): ...
```

Use two subprocesses or multiprocessing processes; do not test only threads.

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m pytest server/tests/test_gpu_lock.py -q
```

Expected: FAIL because `gpu_lock.py` does not exist.

- [ ] **Step 3: Implement OS-backed locking**

```python
@contextmanager
def gpu_lock(path: Path, timeout_seconds: float = 900.0):
    """Acquire an exclusive process lock or raise GPU_LOCK_TIMEOUT."""
```

Use `fcntl.flock(..., LOCK_EX | LOCK_NB)` on Linux and `msvcrt.locking` for Windows regression development. Create only the parent directory and one-byte lock file; never delete a lock file while another process may have it open.

- [ ] **Step 4: Wrap only GPU inference**

Acquire the lock around building-model inference in `BuildingEngine.process()` and around DINO/SAM inference in `FacadeMLRuntime.process()`. Do not hold the lock during Supabase downloads, H0, SciPy mesh optimization, Storage upload, or Blender.

- [ ] **Step 5: Run lock and model-boundary tests**

```powershell
python -m pytest server/tests/test_gpu_lock.py server/tests/test_building_engine.py rural_house_generator/backend/tests/test_full_pipeline.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit the shared GPU lock**

```powershell
git branch --show-current
git add server/src/village_processing/gpu_lock.py server/tests/test_gpu_lock.py server/src/village_processing/building/engine.py rural_house_generator/backend/ml_worker.py
git commit -m "feat: serialize shared gpu inference"
```

---

### Task 7: Package facade services and Blender 3.0.1 in Docker Compose

**Files:**
- Create: `linux/Dockerfile.facade-worker`
- Create: `linux/Dockerfile.facade-ml`
- Create: `linux/Dockerfile.facade-lama`
- Create: `linux/requirements-facade-worker.txt`
- Create: `linux/requirements-facade-ml.txt`
- Create: `linux/requirements-facade-lama.txt`
- Modify: `linux/compose.yaml`
- Modify: `linux/.env.example`
- Modify: `linux/tests/test_deployment_contract.py`

**Interfaces:**
- Consumes: repository source, read-only model mounts, `/work`, internal Docker DNS, and the secret env file.
- Produces: `facade-worker`, `facade-ml`, and `facade-lama` services with deterministic startup and health checks.

- [ ] **Step 1: Extend deployment contract tests first**

Add assertions that:

```python
assert "facade-worker" in services
assert "facade-ml" in services
assert "facade-lama" in services
assert "ports" not in services["facade-ml"]
assert "ports" not in services["facade-lama"]
assert services["facade-worker"]["environment"]["BLENDER_EXECUTABLE"] == "/usr/bin/blender"
assert "/work" in shared_mount_targets(services, "facade-worker", "facade-ml", "facade-lama")
assert "SUPABASE_SERVICE_ROLE_KEY" not in serialized_service(services["facade-ml"])
assert "SUPABASE_SERVICE_ROLE_KEY" not in serialized_service(services["facade-lama"])
```

Also assert read-only model mounts, shared GPU lock path, bounded logs, non-root users, and no host networking.

- [ ] **Step 2: Run deployment tests and verify failure**

```powershell
python -m pytest linux/tests/test_deployment_contract.py -q
```

Expected: FAIL because facade services are absent.

- [ ] **Step 3: Implement the facade-worker image**

Base it on an Ubuntu release capable of installing exactly Blender 3.0.1 from the pinned package source or copied official archive with verified SHA-256. Install the `server` package and make the repository importable so `rural_house_generator.backend` can be imported. Run as a fixed non-root UID/GID and start:

```text
python -m village_processing facade-worker
```

Set `BLENDER_EXECUTABLE=/usr/bin/blender`, `RURAL_FACADE_PIPELINE=full-local`, and the internal URLs `http://facade-ml:8012`, `http://facade-lama:8013`.

- [ ] **Step 4: Implement model service images**

`facade-ml` installs the CUDA-compatible PyTorch/torchvision/transformers/SAM2 stack and starts:

```text
python -m rural_house_generator.backend.ml_worker --host 0.0.0.0 --port 8012
```

`facade-lama` installs the pinned SimpleLaMa-compatible stack and starts:

```text
python -m rural_house_generator.backend.lama_server --host 0.0.0.0 --port 8013
```

Both receive `/work`; only `facade-ml` reserves the GPU. If LaMa is configured for CUDA in the pinned runtime, it must use the same GPU reservation and shared lock rather than run concurrently.

- [ ] **Step 5: Extend Compose with readiness and networks**

Place both model services only on `facade-internal`, defined with `internal: true`. Place `facade-worker` on `facade-internal` and the outbound network. Start Worker only after both health checks succeed. Do not add `ports` to any facade service.

- [ ] **Step 6: Run static deployment verification**

```powershell
python -m pytest linux/tests/test_deployment_contract.py -q
docker compose -f linux/compose.yaml config --quiet
```

Expected: tests PASS; Compose validation PASS where Docker is installed.

- [ ] **Step 7: Commit the containers**

```powershell
git branch --show-current
git add linux
git commit -m "build: package facade services for linux"
```

---

### Task 8: Add the facade-worker CLI and health reporting

**Files:**
- Modify: `server/src/village_processing/__main__.py`
- Modify: `server/src/village_processing/health.py`
- Create: `server/tests/test_facade_cli.py`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FACADE_WORK_ROOT`, `WORKER_ID`, internal service URLs, and Blender path.
- Produces: `python -m village_processing facade-worker` and health checks that fail before claims if required dependencies are unavailable.

- [ ] **Step 1: Write failing CLI parser tests**

```python
def test_parser_registers_facade_worker_command(): ...
def test_facade_worker_requires_service_role_configuration(monkeypatch): ...
def test_facade_health_checks_blender_and_internal_workers(monkeypatch): ...
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
python -m pytest server/tests/test_facade_cli.py -q
```

Expected: FAIL because `facade-worker` is not registered.

- [ ] **Step 3: Register and construct the worker**

Build the Supabase client only in this CLI path, instantiate `FacadeGateway`, `FacadeJobProcessor`, `FacadePipeline`, and `FacadeWorker`, then call `asyncio.run(worker.run_forever())`. Do not pass the service-role key to model-client constructors or log the environment.

- [ ] **Step 4: Add startup health checks**

Verify:

```text
Blender executable exists and reports 3.0.1
facade-ml /health responds
facade-lama /health responds
/work is writable
model directories and SAM2 checkpoint exist
facade-generation and house-photos buckets are reachable
```

Health failure exits before calling `claim_next_facade_run`.

- [ ] **Step 5: Run CLI and server tests**

```powershell
python -m pytest server/tests/test_facade_cli.py server/tests/test_health.py server/tests/test_worker.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit the CLI**

```powershell
git branch --show-current
git add server/src/village_processing/__main__.py server/src/village_processing/health.py server/tests/test_facade_cli.py
git commit -m "feat: add facade worker runtime command"
```

---

### Task 9: Add the browser Supabase facade client

**Files:**
- Create: `rural_house_generator/facade-queue-client.js`
- Create: `rural_house_generator/facade-queue-client.test.js`
- Modify: `rural_house_generator/index.html`

**Interfaces:**
- Consumes: authenticated Supabase client passed from the opener bridge or initialized from the existing public URL/key configuration.
- Produces: `submit()`, `getRun()`, `findLatestRun()`, `confirmCrop()`, `cancel()`, `listArtifacts()`, `createArtifactUrl()`, and `subscribe()`.

- [ ] **Step 1: Write failing client tests with a fake Supabase chain**

```javascript
test('submit sends photo id and never sends owner id or photo url', async () => {
  const client = createFacadeQueueClient(fakeSupabase());
  await client.submit({ courseId: 'course-1', spaceId: 'current', objectCode: 'B-1', photoId: 9 });
  assert.deepEqual(fake.rpcArgs, {
    p_course_id: 'course-1', p_space_id: 'current', p_object_code: 'B-1', p_photo_id: 9
  });
  assert.equal('owner_id' in fake.rpcArgs, false);
  assert.equal('photo_url' in fake.rpcArgs, false);
});

test('confirm crop sends only whitelisted geometry values', async () => { ... });
test('artifact urls are short-lived signed urls', async () => { ... });
test('subscription filters by run id and can unsubscribe', async () => { ... });
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test rural_house_generator/facade-queue-client.test.js
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the client API**

```javascript
function createFacadeQueueClient(supabaseClient) {
  return {
    submit({ courseId, spaceId, objectCode, photoId }) {},
    getRun(runId) {},
    findLatestRun({ spaceId, objectCode }) {},
    confirmCrop(runId, { cropTop, roofType, buildingWidth, buildingDepth }) {},
    cancel(runId) {},
    listArtifacts(runId) {},
    createArtifactUrl(path, expiresIn = 300) {},
    subscribe(runId, onChange) {},
  };
}
```

RPC payloads must contain only explicitly listed keys. Artifact reads use the private `facade-generation` bucket and signed URLs; never persist the signed URL in local storage.

- [ ] **Step 4: Load the module before generator application code**

Add `facade-queue-client.js` to `rural_house_generator/index.html` before `app.js`, preserving existing preset mode scripts.

- [ ] **Step 5: Run browser unit tests**

```powershell
node --test rural_house_generator/facade-queue-client.test.js rural_house_generator/photo-material-bridge.test.js rural_house_generator/photo-workflow.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the client**

```powershell
git branch --show-current
git add rural_house_generator/facade-queue-client.js rural_house_generator/facade-queue-client.test.js rural_house_generator/index.html
git commit -m "feat: add facade queue browser client"
```

---

### Task 10: Convert the generator to queued two-stage interaction

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/photo-workflow.test.js`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/photo-material-bridge.js`
- Modify: `rural_house_generator/photo-material-bridge.test.js`

**Interfaces:**
- Consumes: historical photo records including `id`, `FacadeQueueClient`, task Realtime updates, signed preview/GLB URLs, and the existing model-ready `postMessage` contract.
- Produces: recoverable UI states `queued_rectification`, `rectifying`, `awaiting_crop`, `queued_generation`, `generating`, `completed`, `failed`, and `offline`.

- [ ] **Step 1: Replace the local-only transition tests first**

```javascript
test('remote facade flow pauses at awaiting_crop', () => {
  assert.equal(transitionFacadeState('queued_rectification', 'claimed'), 'rectifying');
  assert.equal(transitionFacadeState('rectifying', 'rectified'), 'awaiting_crop');
});

test('completed run may regenerate without rectifying again', () => {
  assert.equal(transitionFacadeState('completed', 'confirm_crop'), 'queued_generation');
});

test('historical photos default to newest but preserve manual selection', () => { ... });
test('reload restores the newest active run for the building', () => { ... });
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test rural_house_generator/photo-workflow.test.js rural_house_generator/photo-material-bridge.test.js
```

Expected: FAIL because remote states and photo-ID selection are absent.

- [ ] **Step 3: Implement the pure state/presentation layer**

Add:

```javascript
function normalizeFacadeRun(run) {}
function transitionFacadeState(current, event) {}
function facadeStatusPresentation(run, workerAvailability) {}
function chooseDefaultHistoricalPhoto(photos, selectedId = '') {}
function canConfirmCrop(run) { return run?.status === 'awaiting_crop' || run?.status === 'completed'; }
```

Keep the existing preset generation path unchanged.

- [ ] **Step 4: Replace direct localhost requests in photo mode**

Photo mode must no longer call `/api/jobs`, `/rectify`, `/prepare-direct`, `/generate`, or `/health`. It submits the selected historical `photo.id`, subscribes to the run, loads `rectified_preview` at `awaiting_crop`, and calls `confirmCrop()` when the student clicks generate.

Retain local upload only as a way to add a photo to the existing building photo library first; the resulting `object_photos.id` becomes the queue input.

- [ ] **Step 5: Implement reload and reconnection recovery**

On initialization, call `findLatestRun({spaceId, objectCode})`. If the run is active or completed, restore it; otherwise show the newest historical photo. On Realtime disconnect, poll the current run with bounded exponential backoff up to 15 seconds. Stop polling when the page is hidden and resume on visibility change.

- [ ] **Step 6: Load and return the completed GLB**

Resolve the `building_glb` artifact through a signed URL, fetch the ArrayBuffer, load it in the existing Three.js preview, and call the unchanged `PhotoWorkflow.buildModelReadyMessage()` so `app-3d.js` continues receiving binary GLB data.

- [ ] **Step 7: Run generator tests**

```powershell
node --test rural_house_generator/*.test.js
```

Expected: PASS, including preset-mode regressions and queued photo mode.

- [ ] **Step 8: Commit the two-stage UI**

```powershell
git branch --show-current
git add rural_house_generator
git commit -m "feat: queue two-stage facade generation"
```

---

### Task 11: Preserve secure photo IDs and authenticated context across the 3D bridge

**Files:**
- Modify: `app-3d.js`
- Create: `features/models/facade-generator-bridge.test.js`
- Modify: `features/ui/course-workbench.test.js`

**Interfaces:**
- Consumes: existing `object_photos` rows and authenticated platform Supabase client.
- Produces: photo-material messages with stable numeric IDs and enough public configuration for the child page to use the same authenticated session without exposing `service_role`.

- [ ] **Step 1: Write failing bridge tests**

Assert that:

```javascript
assert.match(source, /id:\s*String\(item\?\.id/);
assert.match(source, /village-house-generator:facade-context/);
assert.doesNotMatch(source, /service.role|SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY/i);
assert.match(source, /event\.origin[\s\S]*window\.location\.origin/);
```

Add a behavioral test showing that photos are sorted newest-first and the chosen `photo_id` survives normalization.

- [ ] **Step 2: Run tests and verify failure**

```powershell
node --test features/models/facade-generator-bridge.test.js features/ui/course-workbench.test.js
```

Expected: FAIL because the facade context message is absent.

- [ ] **Step 3: Add a same-origin facade context handshake**

Send only the Supabase project URL, publishable key already present in the public app, course/space/building identifiers, and authenticated-session availability. Do not transmit access tokens by `postMessage`; the same-origin child obtains the session from the Supabase client/storage mechanism.

- [ ] **Step 4: Preserve exact photo identity**

Return `id`, `photo_path` availability, timestamp, and display URL. The display URL is for thumbnails only; submission uses `id`. Keep exact `object_code` matching and existing namespace compatibility.

- [ ] **Step 5: Run bridge and integration tests**

```powershell
node --test features/models/facade-generator-bridge.test.js features/ui/course-workbench.test.js rural_house_generator/photo-material-bridge.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the bridge**

```powershell
git branch --show-current
git add app-3d.js features/models/facade-generator-bridge.test.js features/ui/course-workbench.test.js
git commit -m "feat: connect facade queue to 3d workspace"
```

---

### Task 12: Complete operations documentation and deployment acceptance automation

**Files:**
- Modify: `linux/README.md`
- Modify: `linux/scripts/check-host.sh`
- Modify: `linux/scripts/verify-deployment.sh`
- Modify: `linux/systemd/village-platform.service`
- Create: `server/tests/integration/test_live_facade_queue.py`
- Modify: `server/docs/supabase-worker-operations.md`

**Interfaces:**
- Consumes: Ubuntu RTX 4090 host, GitHub branch, Supabase migration, model/checkpoint directories, and `/etc/village-platform/worker.env`.
- Produces: repeatable first install, update, start, rollback, monitoring, and one real-history-photo acceptance procedure.

- [ ] **Step 1: Write failing operations contract assertions**

Extend `linux/tests/test_deployment_contract.py` to require documentation and scripts containing:

```text
codex/facade-linux-worker
/srv/village-platform/models
/var/lib/village-platform/runtime
/etc/village-platform/worker.env
Facade Generation Worker Queue.sql
docker compose build
docker compose up -d
Blender 3.0.1
awaiting_crop
rollback
```

- [ ] **Step 2: Run contract tests and verify failure**

```powershell
python -m pytest linux/tests/test_deployment_contract.py -q
```

Expected: FAIL on missing facade operations instructions.

- [ ] **Step 3: Document the exact GitHub-to-Linux sequence**

Document first install:

```bash
sudo git clone --branch codex/facade-linux-worker https://github.com/life-is-change/village-storymap.git /opt/village-storymap
sudo install -d -m 0750 /srv/village-platform/models /var/lib/village-platform/runtime
sudo install -d -m 0750 /etc/village-platform
sudo install -m 0600 /opt/village-storymap/linux/.env.example /etc/village-platform/worker.env
cd /opt/village-storymap
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml build
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml up -d
```

Document updates with `git fetch`, a pinned commit checkout or fast-forward-only branch update, Compose rebuild, health verification, and rollback to the previous commit/image tag.

- [ ] **Step 4: Extend host and deployment checks**

`check-host.sh` verifies Docker/Compose, NVIDIA container runtime, RTX 4090 visibility, model files, SAM2 checkpoint, directory ownership, and absence of public facade ports. `verify-deployment.sh` verifies container health, Blender reports 3.0.1, model workers are internally reachable, the Worker heartbeat is current, and Supabase buckets are accessible.

- [ ] **Step 5: Add opt-in live Supabase integration coverage**

Mark the test `live_supabase`. It submits a fixture task referencing an explicitly configured real `photo_id`, observes rectification publication, confirms crop, observes completion, validates signed artifacts, and cancels/cleans only the fixture run. Skip unless all explicit live-test variables are present.

- [ ] **Step 6: Run complete developer-workstation verification**

```powershell
node --test features/data/facade-generation-security.test.js features/models/facade-generator-bridge.test.js rural_house_generator/*.test.js
python -m pytest server/tests rural_house_generator/backend/tests linux/tests -q
git diff --check
```

Expected: all applicable tests PASS; environment-dependent real model/Blender/live Supabase tests explicitly SKIP when prerequisites are absent.

- [ ] **Step 7: Confirm branch and forbidden-file boundary**

```powershell
git branch --show-current
git status --short
git ls-files | rg "\.(pth|pt|ckpt|pbf|glb)$|(^|/)\.env$|runtime_storage|huggingface"
```

Expected: branch is `codex/facade-linux-worker`; no forbidden model, secret, cache, or runtime artifact is tracked.

- [ ] **Step 8: Commit operations support**

```powershell
git branch --show-current
git add linux server/docs/supabase-worker-operations.md server/tests/integration/test_live_facade_queue.py
git commit -m "docs: add facade worker deployment operations"
```

---

### Task 13: Publish the branch and perform the Linux production acceptance run

**Files:**
- No additional tracked files unless acceptance reveals a reproducible defect.

**Interfaces:**
- Consumes: all prior tasks, approved Supabase SQL execution, server-only model assets and credentials.
- Produces: pushed `codex/facade-linux-worker`, running Linux containers, healthy Worker heartbeat, and one completed real historical-photo GLB task.

- [ ] **Step 1: Verify the final branch locally**

```powershell
git branch --show-current
git status --short
git log --oneline --decorate -15
```

Expected: clean `codex/facade-linux-worker`; no implementation commit exists on `learning`.

- [ ] **Step 2: Push only the feature branch**

```powershell
git push -u origin codex/facade-linux-worker
```

- [ ] **Step 3: Apply the reviewed Supabase migration**

Run `supabase_SQL/Facade Generation Worker Queue.sql` through the controlled Supabase migration workflow. Verify functions, grants, RLS, bucket privacy, and Realtime publication before starting Worker claims.

- [ ] **Step 4: Install server-only assets**

Place Grounding DINO, SAM2.1, and LaMa weights/caches under `/srv/village-platform/models`; write real credentials only to `/etc/village-platform/worker.env` with mode `0600`; ensure `/var/lib/village-platform/runtime` is owned by the container UID/GID.

- [ ] **Step 5: Deploy the pinned branch on Linux**

```bash
cd /opt/village-storymap
git fetch origin
git switch codex/facade-linux-worker
git pull --ff-only
./linux/scripts/check-host.sh
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml build
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml up -d
./linux/scripts/verify-deployment.sh
```

- [ ] **Step 6: Run the first real task as production acceptance**

From the student page, select a valid historical building photo, wait for `awaiting_crop`, drag and confirm the roof line, wait for `completed`, load the GLB in the generator and main Cesium view, then adjust the crop and regenerate once. Verify the second successful GLB replaces the first and a deliberately failed revision would preserve the last successful result.

- [ ] **Step 7: Record acceptance or rollback**

If acceptance passes, record the deployed Git commit and immutable image tags in the operations log. If it fails, pause facade claims, collect bounded logs and the run ID, check out the previous deployed commit/images, restart Compose, and leave the failed facade task available for diagnosis without changing the GIS queue.
