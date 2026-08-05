# Linux Worker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub-safe `linux/` deployment package for the existing Supabase geoprocessing Worker and make the minimum backward-compatible server changes required for Ubuntu 22.04 with an RTX 4090.

**Architecture:** Build separate GIS Worker and GPU building-service images from the shared `server/` package. Compose connects them over an internal network, gives only the GIS Worker outbound Supabase access, mounts datasets read-only at `/data`, and mounts the same writable runtime at `/work` in both containers.

**Tech Stack:** Ubuntu 22.04, Docker Engine and Compose, NVIDIA Container Toolkit, CUDA 11.8, PyTorch 2.0.1, MMCV 1.7.2, MMDetection 2.28.2, Python 3.10/3.11, Conda-forge GIS packages, FastAPI, pytest, Bash, systemd.

**Implementation status:** Completed in the working tree. The task checkboxes below preserve the original TDD execution plan; final review hardening and the target-host acceptance boundary are recorded at the end.

## Global Constraints

- Preserve all existing Windows PowerShell scripts and the Windows loopback default `http://127.0.0.1:8021`.
- Do not change Supabase SQL, RPC contracts, Storage paths, browser code, model code, or GeoJSON artifact formats.
- Do not write or copy a real service-role key, TIF, PBF, PTH, `.env`, runtime output, or local absolute Windows path into tracked Linux deployment files.
- The building service must have no host port and no egress network; only `geo-worker` receives `/etc/village-platform/worker.env`.
- Both containers must mount `/var/lib/village-platform/runtime` at the identical container path `/work`.
- Both containers must mount `/srv/village-platform/data` read-only at `/data`.
- Production Python behavior changes require a failing regression test before implementation.
- Configuration artifacts require deployment contract tests that fail before the files are added.
- Work in the current user-requested checkout; preserve unrelated dirty files and do not stage, commit, or push without a separate user request.

---

### Task 1: Redact Linux Paths from User-Visible Errors — Completed

**Files:**
- Modify: `server/tests/test_supabase_gateway.py`
- Modify: `server/src/village_processing/queue/gateway.py`

**Interfaces:**
- Consumes: `safe_message(message: str) -> str`.
- Produces: safe error text that redacts URLs, Windows paths, POSIX paths, and JWT-like credentials while preserving ordinary text and the 300-character bound.

- [ ] **Step 1: Add the failing POSIX path regression test**

Add to `server/tests/test_supabase_gateway.py`:

```python
def test_safe_message_redacts_posix_paths_without_hiding_ordinary_slashes():
    message = "cannot read /srv/village-platform/data/input.tif; ratio 1/2"

    result = safe_message(message)

    assert "/srv/" not in result
    assert "[local path]" in result
    assert "1/2" in result
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_supabase_gateway.py -v
```

Expected: the new test fails because `/srv/village-platform/data/input.tif` remains visible.

- [ ] **Step 3: Implement minimal cross-platform redaction**

In `gateway.py`, process URLs first and add the POSIX pattern:

```python
def safe_message(message: str) -> str:
    text = re.sub(r"https?://\S+", "[remote service]", str(message))
    text = re.sub(r"(?i)\b[a-z]:\\[^\r\n,;]+", "[local path]", text)
    text = re.sub(r"(?<![\w:])\/[^\s,;]+", "[local path]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_.-]{20,}\b", "[credential]", text)
    text = text.replace("Traceback (most recent call last):", "")
    return " ".join(text.split())[:300]
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run the same pytest command. Expected: all gateway tests pass.

### Task 2: Use the Docker Building-Service URL in Local Runs — Completed

**Files:**
- Modify: `server/tests/test_contracts.py`
- Modify: `server/src/village_processing/__main__.py`

**Interfaces:**
- Produces: `_building_service_url() -> str`, returning `BUILDING_SERVICE_URL` or the Windows-compatible loopback default.
- Consumes: the helper in both `worker` and `run` command paths.

- [ ] **Step 1: Add failing URL-selection tests**

Add to `server/tests/test_contracts.py`:

```python
def test_building_service_url_defaults_to_windows_loopback(monkeypatch):
    import village_processing.__main__ as cli
    monkeypatch.delenv("BUILDING_SERVICE_URL", raising=False)
    assert cli._building_service_url() == "http://127.0.0.1:8021"


def test_building_service_url_uses_container_service_name(monkeypatch):
    import village_processing.__main__ as cli
    monkeypatch.setenv("BUILDING_SERVICE_URL", "http://building:8021")
    assert cli._building_service_url() == "http://building:8021"
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_contracts.py -v
```

Expected: both new tests fail because `_building_service_url` does not exist.

- [ ] **Step 3: Add and use the helper**

Add:

```python
def _building_service_url() -> str:
    return os.environ.get("BUILDING_SERVICE_URL", "http://127.0.0.1:8021")
```

Pass `_building_service_url()` to `NativeProcessors` in both `worker` and `run` branches.

- [ ] **Step 4: Run and verify GREEN**

Run the focused contracts tests. Expected: all tests pass.

### Task 3: Add Model-Loading Readiness Without Changing Windows Liveness — Completed

**Files:**
- Modify: `server/tests/test_building_engine.py`
- Modify: `server/src/village_processing/building/service.py`

**Interfaces:**
- Preserves: `GET /health -> {"ok": True, "model_loaded": bool}`.
- Produces: `GET /ready`, which returns safe readiness data only after `_get_engine()` succeeds and maps initialization failure to HTTP 503 `MODEL_NOT_READY`.

- [ ] **Step 1: Add failing readiness tests**

Add:

```python
def test_ready_loads_the_engine_and_reports_device(monkeypatch):
    from types import SimpleNamespace
    from village_processing.building import service

    monkeypatch.setattr(service, "_get_engine", lambda: SimpleNamespace(device="cuda:0"))

    assert service.ready() == {
        "ok": True,
        "model_loaded": True,
        "device": "cuda:0",
    }


def test_ready_returns_stable_503_without_local_path(monkeypatch):
    from fastapi import HTTPException
    from village_processing.building import service

    def fail():
        raise RuntimeError("cannot load /data/private/model.pth")

    monkeypatch.setattr(service, "_get_engine", fail)
    with pytest.raises(HTTPException) as captured:
        service.ready()

    assert captured.value.status_code == 503
    assert captured.value.detail == "MODEL_NOT_READY"
    assert "/data/" not in str(captured.value.detail)
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
E:\anaconda3\envs\platform_building_worker\python.exe -m pytest server/tests/test_building_engine.py -v
```

Expected: new tests fail because `ready` does not exist.

- [ ] **Step 3: Implement `/ready`**

Add:

```python
@app.get("/ready")
def ready():
    try:
        engine = _get_engine()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="MODEL_NOT_READY") from exc
    return {"ok": True, "model_loaded": True, "device": engine.device}
```

Do not change `/health`.

- [ ] **Step 4: Run and verify GREEN**

Run the building tests. Expected: all tests pass.

### Task 4: Define the Linux Deployment Security Contract — Completed

**Files:**
- Create: `linux/tests/test_deployment_contract.py`

**Interfaces:**
- Produces: repository-level assertions for the complete set of Linux artifacts, Compose isolation, mounts, secrets, GPU assignment, image pins, and startup readiness.

- [ ] **Step 1: Create a failing contract test**

The test must load `linux/compose.yaml` with PyYAML and assert:

```python
EXPECTED = {
    "README.md",
    "compose.yaml",
    "Dockerfile.geo",
    "Dockerfile.geo.dockerignore",
    "Dockerfile.building",
    "Dockerfile.building.dockerignore",
    "requirements-building.txt",
    ".env.example",
    "scripts/check-host.sh",
    "scripts/verify-deployment.sh",
    "systemd/village-platform.service",
}
```

It must also assert:

```python
assert "ports" not in building
assert "ports" not in worker
assert building["restart"] == "unless-stopped"
assert worker["restart"] == "unless-stopped"
assert compose["networks"]["backend"]["internal"] is True
assert building["networks"] == ["backend"]
assert worker["networks"] == ["backend", "egress"]
assert worker["depends_on"]["building"]["condition"] == "service_healthy"
assert "timeout=170" in building["healthcheck"]["test"][-1]
assert building["healthcheck"]["timeout"] == "180s"
assert "env_file" not in building
assert worker["env_file"] == ["/etc/village-platform/worker.env"]
```

Normalize the long-form volumes and assert both services use the same `/work`
source and a read-only `/data` source. Assert only building contains a GPU
device reservation with `capabilities: [gpu]`.

Scan all deployment files and reject `SUPABASE_SERVICE_ROLE_KEY=eyJ`, drive
letter paths, `server/.env`, `COPY .`, and mutable image tags ending in
`:latest`.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest linux/tests/test_deployment_contract.py -v
```

Expected: tests fail because deployment files do not exist.

### Task 5: Build the Two Linux Images and Compose Topology — Completed

**Files:**
- Create: `linux/Dockerfile.geo`
- Create: `linux/Dockerfile.geo.dockerignore`
- Create: `linux/Dockerfile.building`
- Create: `linux/Dockerfile.building.dockerignore`
- Create: `linux/requirements-building.txt`
- Create: `linux/compose.yaml`
- Create: `linux/.env.example`

**Interfaces:**
- Produces: `village-geo-worker:${IMAGE_TAG}` and `village-building-worker:${IMAGE_TAG}` images, where `IMAGE_TAG` is the full Git commit.
- Provides: internal `building:8021`, outbound queue Worker, identical `/work`, read-only `/data`, and safe environment injection.

- [ ] **Step 1: Add the building dependency lock**

Create `requirements-building.txt` with exactly:

```text
mmdet==2.28.2
numpy==1.26.4
scipy==1.11.4
pandas==2.1.4
opencv-python==4.8.1.78
rasterio==1.4.3
fastapi==0.115.6
uvicorn==0.32.1
pydantic==2.13.3
python-dotenv>=1.0,<2
```

- [ ] **Step 2: Add the building Dockerfile**

Use `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04`, install only headless
runtime libraries, install PyTorch 2.0.1/torchvision 0.15.2 from the cu118
index, install `mmcv-full==1.7.2` from the official cu118/torch2.0 wheel index,
install the pinned requirements and local server package, create UID/GID 10001,
and run Uvicorn as that user.

Copy only:

```dockerfile
COPY server/pyproject.toml /app/server/pyproject.toml
COPY server/src /app/server/src
COPY server/config /app/server/config
COPY linux/requirements-building.txt /tmp/requirements-building.txt
```

- [ ] **Step 3: Add the GIS Dockerfile**

Use `ubuntu:22.04`, download the official
`Miniforge3-26.3.2-2-Linux-x86_64.sh`, verify SHA-256
`42260ffe3830fb953d5eee1bbb32229ff06aa7c3833c1ed7a9a0420a95685d94`,
create the existing `platform_geo_worker` environment, install the local server
package, create UID/GID 10001, and put the environment binaries first on PATH.

Copy only the environment YAML, `server/pyproject.toml`, `server/src`, and
`server/config`.

- [ ] **Step 4: Add Dockerfile-specific ignore rules**

Both ignore files must exclude at least:

```text
.git
**/.env
**/.env.*
!linux/.env.example
server/runtime
**/__pycache__
**/.pytest_cache
*.pth
*.pbf
*.tif
*.tif.ovr
node_modules
```

- [ ] **Step 5: Add Compose**

Define `building` and `geo-worker` using long-form mounts. Required values:

```yaml
restart: unless-stopped
read_only: true
tmpfs:
  - /tmp:size=2g,mode=1777
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

Building command binds `0.0.0.0:8021`, has `shm_size: 8gb`, one NVIDIA GPU
reservation, direct non-secret model environment, readiness with a 180-second
start period, and only the `backend` network. Worker loads only
`/etc/village-platform/worker.env`, depends on healthy building, and joins
`backend` plus `egress`. Define no `ports`.

Configure bounded logs for each service:

```yaml
logging:
  driver: local
  options:
    max-size: 20m
    max-file: "5"
```

- [ ] **Step 6: Add the safe environment template**

Create `.env.example` with the exact container paths, `WORKER_ID=linux-rtx4090-01`,
the non-secret example values `https://your-project.supabase.co` and
`replace-on-server`, and no model or Windows paths.

- [ ] **Step 7: Run the contract tests and verify GREEN for container topology**

Run the Task 4 pytest command. Expected: container artifact and topology tests pass; script/README tests may remain failing until Tasks 6 and 7.

### Task 6: Add Host and Runtime Verification Scripts — Completed

**Files:**
- Create: `linux/scripts/check-host.sh`
- Create: `linux/scripts/verify-deployment.sh`
- Modify: `linux/tests/test_deployment_contract.py`

**Interfaces:**
- Produces: deterministic preflight and post-start verification commands that never print credentials.

- [ ] **Step 1: Add failing script contract assertions**

Assert both scripts start with `#!/usr/bin/env bash` and `set -Eeuo pipefail`.
Assert `check-host.sh` checks `docker`, `docker compose`, `nvidia-smi`, the GPU
container runtime, every registered dataset/model file, and runtime write access.
Assert `verify-deployment.sh` checks Compose state, `/ready`, GIS health,
`torch.cuda.is_available()`, `mmcv.ops.nms`, and a `/process` building-service
smoke output that reuses the already-loaded model. Reject
any command that prints the environment or `/etc/village-platform/worker.env`.

- [ ] **Step 2: Run and verify RED**

Run deployment tests. Expected: script assertions fail because scripts do not exist.

- [ ] **Step 3: Implement `check-host.sh`**

Use fixed paths that exactly match Compose:

```bash
REPO_ROOT=/opt/village-storymap
DATA_ROOT=/srv/village-platform/data
WORK_ROOT=/var/lib/village-platform/runtime
ENV_FILE=/etc/village-platform/worker.env
```

Check exact catalog files including the DEM `.ovr`, require env mode no broader
than `0600`, verify runtime write access without deleting existing files, and
run a CUDA 11.8 `nvidia-smi` container probe.

- [ ] **Step 4: Implement `verify-deployment.sh`**

Run Compose from `/opt/village-storymap/linux`, validate both services, execute
the CUDA/MMCV import check, execute `python -m village_processing health`, crop
the fixed AOI, post a manifest to `http://building:8021/process`, and parse the
resulting GeoJSON as a FeatureCollection. Do not start a second model process,
and do not submit or mutate a live Supabase run.

- [ ] **Step 5: Run tests and shell parsing**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest linux/tests/test_deployment_contract.py -v
bash -n linux/scripts/check-host.sh
bash -n linux/scripts/verify-deployment.sh
```

Expected: contract tests and Bash syntax checks pass.

### Task 7: Add Boot Integration and Complete Operator Documentation — Completed

**Files:**
- Create: `linux/systemd/village-platform.service`
- Create: `linux/README.md`
- Modify: `linux/tests/test_deployment_contract.py`

**Interfaces:**
- Produces: boot-time Compose lifecycle and an end-to-end human runbook.

- [ ] **Step 1: Add failing systemd and documentation assertions**

Assert the unit includes Docker/network ordering, `Type=oneshot`,
`RemainAfterExit=yes`, the fixed repository working directory, Compose
`up -d --remove-orphans`, Compose `stop`, and `WantedBy=multi-user.target`.

Assert README documents all of these exact phases: architecture, prerequisites,
driver/Docker/Toolkit installation links, directory creation, data transfer,
SHA-256 checks, secret creation, image build, preflight, local smoke,
Supabase canary, zero-loss cutover, routine monitoring, immutable-tag upgrade,
rollback to Windows, and troubleshooting. Assert it explicitly says not to
publish port 8021 or commit secrets/data/models.

- [ ] **Step 2: Run and verify RED**

Run deployment tests. Expected: unit/README assertions fail because files do not exist.

- [ ] **Step 3: Add the systemd unit**

Use:

```ini
[Unit]
Description=Village geoprocessing worker containers
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/village-storymap/linux
ExecStart=/usr/bin/docker compose --env-file /etc/village-platform/worker.env up -d --remove-orphans
ExecStop=/usr/bin/docker compose --env-file /etc/village-platform/worker.env stop
TimeoutStartSec=0
TimeoutStopSec=900

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Write the operator README**

Provide copyable commands using the fixed paths. The cutover sequence must
pause new claims, drain the current Windows task, stop Windows, start Linux,
verify heartbeat, submit one small canary, and only then reopen the queue.
Rollback must reverse only the Worker host and require no SQL changes.

- [ ] **Step 5: Verify documentation contracts**

Run deployment tests. Expected: all deployment contract tests pass.

### Task 8: Cross-Platform Regression and Final Verification — Completed

**Files:**
- Modify: `server/tests/test_environment_contract.py`

**Interfaces:**
- Produces: fresh evidence that new behavior and deployment artifacts satisfy the design while existing Windows behavior remains intact.

- [ ] **Step 1: Run focused server tests**

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest `
  server/tests/test_supabase_gateway.py `
  server/tests/test_contracts.py `
  server/tests/test_health.py -v

E:\anaconda3\envs\platform_building_worker\python.exe -m pytest `
  server/tests/test_building_engine.py -v
```

Expected: zero failures.

- [ ] **Step 2: Keep the PowerShell parser check Windows-only**

Add `import sys` and `import pytest`, then decorate only
`test_environment_powershell_scripts_parse_cleanly` with:

```python
@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell parser contract is Windows-only")
```

Keep every assertion and all Windows coverage intact. Then run the GIS suite
while excluding the GPU/MMDetection-only module, and run that module in the
building environment.

- [ ] **Step 3: Run deployment and syntax verification**

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest linux/tests -v
bash -n linux/scripts/check-host.sh
bash -n linux/scripts/verify-deployment.sh
git diff --check -- linux server docs/superpowers
```

If Docker Compose is installed, also run without printing expanded secret values:

```bash
docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml config --quiet
```

- [ ] **Step 4: Audit the exact change scope and secret safety**

Run `git status --short` and verify only the approved design/plan, `linux/`,
four server modules, and their tests are attributable to this task. Search the
new files for JWT-like keys, drive-letter paths, `.pth`, `.pbf`, `.tif`, and
`server/.env`; expected matches are only explicit prohibition/documentation or
safe catalog filenames, never secret values or copied binary assets.

- [ ] **Step 5: Record the remaining Linux-host acceptance boundary**

Document that image pulls/builds, real RTX 4090 model readiness, output parity,
and live Supabase canary require the target Linux host and are not falsely
claimed from the Windows development workstation.

## Review Hardening Addendum

The final read-only review found deployment risks not captured by the initial
task list. They were resolved with regression coverage before final verification:

- [x] Serialize lazy model initialization and allow the first readiness request
  enough time to load the checkpoint without overlapping probes.
- [x] Resolve `ogr2ogr` from an explicit override, `PLATFORM_OGR2OGR`, the
  active environment `PATH`, then the existing Windows fallback.
- [x] Run OSM extraction during the Linux smoke test and require a non-empty
  building result.
- [x] Use full Git commit image tags supplied through the external worker env
  file instead of a reusable date tag.
- [x] Verify `/work` write access as container UID/GID `10001:10001`.
- [x] Keep the persistent queue Worker stopped during pre-verification and move
  its first start after queue pause, Windows drain, and Windows shutdown.
