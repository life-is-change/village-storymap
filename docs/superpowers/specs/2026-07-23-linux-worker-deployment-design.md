# Linux Worker Deployment Design

**Date:** 2026-07-23

**Status:** Approach B approved and implemented; Windows-side verification complete, Linux GPU-host acceptance pending

## Goal

Add a GitHub-safe `linux/` deployment package that moves the existing outbound
Supabase geoprocessing Worker from Windows 11 to an Ubuntu 22.04 RTX 4090 host.
The browser, Supabase schema, queue contract, Storage layout, processing output
format, and existing Windows pilot remain compatible.

## Scope

This change includes:

- two Linux container images: GIS queue Worker and GPU building service;
- Docker Compose orchestration with an internal-only building network;
- Linux host checks, deployment verification, and systemd startup;
- a secret-free environment template and complete operator guide;
- four backward-compatible server changes required by Linux paths and Docker
  service discovery;
- automated contract and regression tests.

This change does not include:

- database, RLS, RPC, Storage policy, or browser changes;
- model retraining or processing algorithm changes;
- public HTTP ingress, Nginx, a domain, or TLS termination;
- committing TIF, PBF, PTH, runtime output, or Supabase credentials;
- multi-GPU scheduling, Kubernetes, or automatic dataset downloads.

## Selected Approach

Use one shared server codebase and add a self-contained `linux/` operations
package. Make only four targeted, backward-compatible changes under `server/`:

1. redact POSIX absolute paths from user-visible error messages;
2. make the local `run` command honor `BUILDING_SERVICE_URL` just like the
   queue Worker already does;
3. add a model-loading readiness endpoint while preserving the existing
   lightweight `/health` endpoint and serialize lazy model loading;
4. discover `ogr2ogr` from the active Linux environment while retaining the
   existing Windows executable as the final fallback.

The rejected alternatives are:

- Linux files only with no server changes: leaves POSIX path disclosure and a
  false-positive readiness check;
- copying Python processing code into `linux/`: creates two implementations
  that will drift and require duplicated fixes.

## Target Architecture

The browser continues to submit work to Supabase. The Linux GIS Worker makes
outbound HTTPS requests to Supabase, claims one run at a time, processes GIS
layers locally, calls the building service across a private Docker network,
and uploads GeoJSON artifacts to the existing private Storage bucket.

The building service receives no Supabase key and has no egress network. It is
not published as a host port. Inside Docker it listens on `0.0.0.0:8021` so the
GIS Worker can reach `http://building:8021`; the lack of a Compose `ports`
mapping keeps it unavailable from the host LAN and public internet.

Both containers bind the same host runtime directory to the same container
path `/work`. This is required because the GIS Worker passes an absolute
manifest path to the building service. Source datasets and model files are
mounted read-only at `/data`.

## Repository Layout

Create the following tracked files:

```text
linux/
  README.md
  compose.yaml
  Dockerfile.geo
  Dockerfile.geo.dockerignore
  Dockerfile.building
  Dockerfile.building.dockerignore
  requirements-building.txt
  .env.example
  scripts/
    check-host.sh
    verify-deployment.sh
  systemd/
    village-platform.service
  tests/
    test_deployment_contract.py
```

Responsibilities:

- `README.md`: exact first installation, data transfer, secret setup, build,
  smoke test, cutover, monitoring, upgrade, rollback, and troubleshooting steps.
- `compose.yaml`: two services, shared mounts, GPU reservation, readiness
  dependency, restart policy, log rotation, and separated internal/egress
  networks.
- `Dockerfile.geo`: create the Python 3.11 Conda GIS runtime from the existing
  `server/environment/platform_geo_worker.yml`, install the local package, and
  run it as a non-root user.
- `Dockerfile.building`: build the CUDA 11.8, Python 3.10, MMDetection 2.x GPU
  runtime and install the local package as a non-root user.
- Dockerfile-specific ignore files: prevent `.git`, secrets, runtime files,
  large source datasets, model weights, and caches from entering build context.
- `requirements-building.txt`: pin the Linux building runtime versions.
- `.env.example`: document container paths and non-secret example values;
  the real secret file lives at `/etc/village-platform/worker.env`.
- `check-host.sh`: fail fast unless Docker, Compose, NVIDIA driver, GPU
  container access, required data files, and writable runtime storage exist.
- `verify-deployment.sh`: verify service state, model readiness, GIS health,
  Supabase Storage access, CUDA/MMCV operators, and a local small-AOI smoke run.
- systemd unit: start and stop the pinned Compose deployment with Docker at
  boot, without embedding credentials.
- deployment contract tests: enforce the security and shared-path invariants
  without requiring a Linux GPU on the developer workstation.

## Runtime Versions

The GIS image retains the repository's Python 3.11 Conda specification.

The building image uses the following Linux baseline:

```text
Python 3.10
CUDA runtime 11.8 with cuDNN 8
torch 2.0.1 + cu118
torchvision 0.15.2 + cu118
mmcv-full 1.7.2 built for CUDA 11.8 / PyTorch 2.0
mmdet 2.28.2
numpy 1.26.4
scipy 1.11.4
pandas 2.1.4
opencv-python 4.8.1.78
rasterio 1.4.3
fastapi 0.115.6
uvicorn 0.32.1
```

PyTorch 2.0.1 is selected because an official Linux `mmcv-full 1.7.2` wheel is
available for the CUDA 11.8 / PyTorch 2.0 ABI. The Windows pilot currently uses
PyTorch 2.1.0 with a compiled Windows MMCV extension; that binary cannot be
copied to Linux. Model parity is therefore an explicit acceptance test before
cutover.

Images must be tagged with an immutable Git commit identifier for production;
operators must not rely on a mutable `latest` tag for rollback.

## Host Paths and Permissions

Use these fixed host paths:

```text
/opt/village-storymap                 repository checkout
/srv/village-platform/data           read-only datasets and model files
/var/lib/village-platform/runtime    writable per-run working data
/etc/village-platform/worker.env     root-readable Worker secrets
```

The data mount is read-only in both containers. The runtime directory is the
only persistent writable bind mount. Containers use a fixed unprivileged UID
and GID; the host runtime directory is owned by that identity. Each container
has a read-only root filesystem and a temporary `/tmp` filesystem.

The real environment file has mode `0600`. The service-role key is injected
only into `geo-worker`; it is absent from the building service, Dockerfiles,
image layers, Compose YAML, scripts, tests, and logs.

## Container Networking and Startup

`building` joins only an internal Docker network. `geo-worker` joins that
internal network plus a normal egress network so it can reach Supabase. No
service declares a host `ports` mapping.

The building service exposes:

- `/health`: process liveness only; unchanged for the Windows pilot;
- `/ready`: initializes `BuildingEngine`, loads the configured checkpoint on
  `cuda:0`, and returns success only after initialization completes.

Compose starts `geo-worker` only after `/ready` passes. Readiness has a long
startup grace period because loading the approximately 777 MiB checkpoint can
take materially longer than starting Uvicorn.

Both services use `restart: unless-stopped`. Container logs use bounded local
rotation. The systemd unit makes deployment lifecycle explicit and starts the
Compose project after Docker and network availability.

## Backward-Compatible Server Changes

### POSIX error-path redaction

Extend `safe_message()` to redact Linux absolute paths while preserving stable
all-uppercase error codes. Tests cover Windows paths, POSIX paths, URLs, JWT-like
credentials, ordinary user messages, and the 300-character output bound.

### Configurable building URL for local runs

Construct `NativeProcessors` with
`os.environ.get("BUILDING_SERVICE_URL", "http://127.0.0.1:8021")` in both the
`worker` and `run` command paths. Existing Windows behavior remains unchanged
because its `.env` already uses the loopback URL.

### Model readiness

Add `/ready` without changing `/health`. The new endpoint invokes the existing
lazy `_get_engine()` boundary and returns only non-sensitive readiness state.
Initialization failures produce HTTP 503 without including model paths or a
traceback. Windows startup continues to check `/health`, so it does not
unexpectedly change its model-loading timing.

## Data and Configuration

Keep the existing relative paths in `server/config/villages.yaml`. Copy the
entire registered directory structure under `/srv/village-platform/data`,
including the DEM `.tif.ovr` sidecar. `PLATFORM_DATA_ROOT=/data` makes those
relative catalog paths resolve unchanged inside the containers.

The Linux Worker environment is:

```dotenv
PLATFORM_DATA_ROOT=/data
PLATFORM_WORK_ROOT=/work
PLATFORM_CATALOG=/app/server/config/villages.yaml
BUILDING_SERVICE_URL=http://building:8021
WORKER_ID=linux-rtx4090-01
PLATFORM_LOG_LEVEL=INFO
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-on-server
```

Model config, checkpoint, work root, and device are supplied directly to the
building service in Compose. Supabase variables are not supplied to it.

## Error Handling and Operations

Host checks stop before build or startup when the GPU runtime, source data, or
permissions are invalid. Compose readiness prevents the Worker from claiming
tasks before the model is usable. The existing queue lease continues to recover
tasks after crashes.

Operators pause new claims before cutover or rollback, wait for the current
Windows task to finish, stop the Windows Worker, start Linux, verify heartbeat,
and then submit one canary run. If the canary fails, they pause the queue, stop
Linux, restart the unchanged Windows Worker, and unpause after its heartbeat
returns. No database rollback is required.

Routine monitoring uses Compose service state and bounded logs, `nvidia-smi`,
the `/ready` health state, disk usage under the runtime root, and the existing
Supabase Worker availability RPC.

## Testing Strategy

Implementation follows red-green-refactor for every Python behavior change.

Developer-workstation verification:

1. new regression tests fail before each server modification;
2. targeted Python tests pass in the existing GIS/building environments;
3. deployment contract tests parse all `linux/` artifacts and verify:
   - no host ports;
   - only the building service receives a GPU reservation;
   - both services mount identical `/work` and read-only `/data` paths;
   - the building network is internal while the Worker has egress;
   - only the Worker receives the secret env file;
   - readiness gates Worker startup;
   - no credential-like value or untracked large asset is embedded;
4. shell scripts pass `bash -n`;
5. Compose passes non-printing configuration validation where Docker Compose is
   available;
6. the existing server unit suite passes with Windows-only PowerShell parsing
   tests skipped on non-Windows hosts rather than removed.

Linux RTX 4090 acceptance verification:

1. host and CUDA container both report the RTX 4090;
2. `torch.cuda.is_available()` is true and `mmcv.ops.nms` imports;
3. `/ready` loads the real model and reports healthy;
4. GIS local health passes, including GDAL's OSM driver and registered data;
5. a fixed small AOI produces valid building GeoJSON and does not OOM;
6. Windows and Linux results for that AOI have compatible feature counts,
   geometry validity, bounds, and source metadata;
7. live Supabase queue/Storage contract passes;
8. one browser-submitted three-module canary run completes and uploads all five
   logical layers before the queue is reopened broadly.

## Acceptance Criteria

The deployment is accepted when:

- every tracked deployment artifact is under `linux/` except the four focused
  server changes and their regression tests;
- a repository scan finds no service-role key, local secret, PTH, PBF, TIF, or
  runtime artifact in the new tracked files;
- the Windows pilot retains its existing loopback startup and passes regression
  tests;
- the Linux building service is unreachable from host/public ports but reachable
  from `geo-worker`;
- the real checkpoint loads on RTX 4090 before the Worker starts;
- the full Linux canary completes through the existing Supabase queue without
  schema or browser changes;
- rollback to the Windows Worker is documented and rehearsable without database
  changes.
