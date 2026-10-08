# Six-service GPU server deployment

Use this from the repository root, including on branch `2026-0926`. The original `linux/compose.yaml` remains the five-worker deployment. The new `linux/compose.gpu.yaml` adds the website; Open WebUI is not part of this project.

| Service | Role | GPU / host port |
| --- | --- | --- |
| web | Static integrated platform, root index.html with built homepage | No GPU; 127.0.0.1:8080 by default |
| geo-worker | Claims Supabase geoprocessing jobs | No direct GPU; calls building internally |
| building | Building segmentation API | NVIDIA GPU; internal 8021 |
| facade-worker | Claims facade jobs and runs Blender pipeline | Calls facade-ml internally |
| facade-ml | Facade segmentation and ML | NVIDIA GPU; internal 8012 |
| facade-lama | Existing CPU LaMa inference | CPU; internal 8013 |

Two services reserve one NVIDIA GPU each; this grants access to the same available GPU, not exclusive ownership or a need for two cards. The existing GPU lock uses the shared runtime directory. No inference API is published to the host. Browser jobs still use Supabase; this does not deploy a local Supabase or migrate data.

## Prerequisites and existing files

- Linux x86_64, Docker Engine, Compose V2 (2.24.6 is suitable), NVIDIA driver and NVIDIA Container Toolkit.
- `nvidia-smi` works on the host. Check GPU container access with:

```bash
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

- The repository must contain `server/src`, `server/config`, `rural_house_generator/backend`, the static frontend, and **built `homepage/dist/index.html`**. The web image serves this build, rather than running VSCode or Vite.
- Keep existing `/srv/village-platform/data`, `/srv/village-platform/models`, and `/var/lib/village-platform/runtime`. These are not downloaded from GitHub and are not inside the transfer ZIP.
- Data layout follows `server/config/villages.yaml`: village imagery, DEM, OSM, the building checkpoint and configuration must exist. Models must include the current facade weights, `/models/building-seg/checkpoints/sam2.1_hiera_large.pt`, Hugging Face cache and LaMa/Torch models. Facade ML uses offline model caches; an empty models directory will not work.
- Docker's own image storage remains `/var/lib/docker`; changing bind paths does not move that storage.

## Set up

Copy the transfer ZIP to the server and extract it **inside your repository root**, so the result is `linux/compose.gpu.yaml`. The ZIP contains deployment files, not application source or images. Review overwrites if you have modified your own `linux/` files.

```bash
cd /media/gpu332/newapply/village-storymap
unzip /path/to/gpu-six-services-20261008.zip
cp linux/gpu.env.example linux/gpu.env
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$(git rev-parse HEAD)/" linux/gpu.env
```

`gpu.env` configures paths and port; it does not contain worker secrets. Defaults match the inspected server paths. If source files are locally modified, use a unique IMAGE_TAG (for example `local-20261008-01`) instead of implying an exact clean Git commit.

Keep the existing private worker environment file. Only create it from the template if it does not exist:

```bash
sudo install -d -m 0750 /etc/village-platform
if ! sudo test -f /etc/village-platform/worker.env; then
  sudo install -m 0600 linux/.env.example /etc/village-platform/worker.env
fi
sudo nano /etc/village-platform/worker.env
```

Fill in the real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, a unique WORKER_ID, and retain the internal paths in the template. Never place the service-role key in frontend JavaScript, the web image, or GitHub. Do not paste the secret environment file into a chat. The already deployed Supabase tables/buckets/permissions must still exist.

The worker containers use UID/GID 10001. Their runtime directory must be writable, and data/models must be readable:

```bash
sudo install -d -o 10001 -g 10001 -m 0750 \
  /var/lib/village-platform/runtime \
  /var/lib/village-platform/runtime/.locks
sudo ls -ld /srv/village-platform/data /srv/village-platform/models
sudo -u '#10001' test -w /var/lib/village-platform/runtime
```

This prepares directory ownership but does not fix previously created unwritable files. Inspect such files before changing their ownership. Missing bind paths deliberately cause startup failure instead of silently creating empty model directories.

## Build and start all six

Run these commands from the repository root. Use sudo because the private worker.env file is root-readable:

```bash
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml config --quiet
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml build
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml up -d
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml ps -a
```

Builds download large NVIDIA/Python dependencies and can take considerable time and disk space. The previous Docker Hub EOF/proxy problem must be resolved for new images to build; a Compose file cannot bypass that network failure. Model startup may take several minutes. `geo-worker` waits for a healthy building service, and `facade-worker` waits for both facade services to be healthy. Only inference services and web have health checks; worker status `running` alone is not proof of a successful end-to-end job.

Existing five-worker containers used the same Compose project name `village-platform`; these commands will manage/recreate those services. The old separately named `village-platform-lab-20261007-web-1` must be stopped before starting the new web service, since it also used port 8080. Leave `open-webui` running on port 3000. If the old `village-platform.service` systemd unit is enabled, replace its old worker-only ExecStart/ExecStop configuration before using it for future automatic starts; otherwise it may manage a different configuration at boot. Do not run two worker deployments against the same queue unintentionally.

## Verify and use

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -I http://127.0.0.1:8080/
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml logs --tail 100 building facade-ml facade-lama
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml logs --tail 100 geo-worker facade-worker
```

Open `http://127.0.0.1:8080/` in a browser **on the GPU server**, sign in, enter the platform, switch 2D/3D, open the house generator, and submit one known small job to verify polling/results. No end-to-end GPU execution has been performed from the Windows development computer.

For another computer, retain the loopback default and forward over SSH:

```bash
ssh -L 8080:127.0.0.1:8080 gpu332@YOUR_SERVER_IP
```

Then open `http://127.0.0.1:8080/` on that computer. Direct LAN access is optional: set WEB_BIND_ADDRESS to the server's LAN IP and configure the firewall appropriately. Browser authentication/storage is scoped to the new website origin; sign in again, and ensure your Supabase Auth redirect configuration permits this origin if using redirects.

Frontend asset downloads, Supabase, terrain and imagery still need network access. Bundled local Cesium assets are included when present in this checkout; this deployment does not backport performance code into older branches.

## Stop / update

```bash
# Stop all six, retaining containers, models and data
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml stop

# Remove this project's containers and networks, retaining data/models/volumes
sudo docker compose --env-file linux/gpu.env -f linux/compose.gpu.yaml down
```

All six use `unless-stopped`. Manually stopped containers remain stopped after Docker restarts. To update, obtain the intended source changes, set a new IMAGE_TAG, then repeat build/up. No GitHub push, branch switch, database migration, or server deployment is performed by creating these files.

## Local verification

The deployment contract checks cover six services, private worker ports, credential isolation, GPU reservations and explicit bind paths. Web staging checks cover excluding dotenv/private keys/backend/tests and including public CSV and Cesium resources. Existing five-worker contract tests remain unchanged.

All 26 tests under `linux/tests` passed on 2026-10-08, including the two new six-service/staging checks. Docker is unavailable on this Windows computer, so image builds, `docker compose config`, GPU readiness and real browser/queue checks must be performed on the GPU server with the commands above. Homepage login/register/logout and generator behavior were not re-tested inside this new image; the frontend source was left unchanged.

Official references: [Compose GPU reservations](https://docs.docker.com/compose/how-tos/gpu-support/) and [Compose configuration validation](https://docs.docker.com/reference/cli/docker/compose/config/).
