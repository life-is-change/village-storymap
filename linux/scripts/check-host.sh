#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT=/opt/village-storymap
DATA_ROOT=/srv/village-platform/data
WORK_ROOT=/var/lib/village-platform/runtime
ENV_FILE=/etc/village-platform/worker.env
COMPOSE_FILE=${REPO_ROOT}/linux/compose.yaml
CUDA_PROBE_IMAGE=nvidia/cuda:11.8.0-base-ubuntu22.04

die() {
  printf 'PRECHECK_FAIL: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_file() {
  [[ -f "$1" ]] || die "required file not found: $1"
}

require_command docker
require_command nvidia-smi
require_command stat
require_command grep
require_command git

docker version >/dev/null 2>&1 || die "Docker daemon is unavailable"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is unavailable"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader \
  || die "NVIDIA driver cannot enumerate the GPU"

docker run --rm --gpus all "${CUDA_PROBE_IMAGE}" nvidia-smi >/dev/null \
  || die "NVIDIA Container Toolkit cannot expose the GPU to ${CUDA_PROBE_IMAGE}"

require_file "${COMPOSE_FILE}"
require_file "${ENV_FILE}"
[[ -d "${DATA_ROOT}" ]] || die "data root not found: ${DATA_ROOT}"
[[ -d "${WORK_ROOT}" ]] || die "runtime root not found: ${WORK_ROOT}"

required_data=(
  "建筑矢量/input_tif/米埗村（洛一洛二洛三）.tif"
  "等高线/广东省_哥白尼DEM.tif"
  "等高线/广东省_哥白尼DEM.tif.ovr"
  "道路、水系/guangdong-260721.osm.pbf"
  "建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py"
  "建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth"
)

for relative in "${required_data[@]}"; do
  require_file "${DATA_ROOT}/${relative}"
done

env_mode=$(stat -c '%a' "${ENV_FILE}")
case "${env_mode}" in
  400|600) ;;
  *) die "${ENV_FILE} must have mode 0400 or 0600, found ${env_mode}" ;;
esac

for key in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY PLATFORM_DATA_ROOT \
  PLATFORM_WORK_ROOT PLATFORM_CATALOG BUILDING_SERVICE_URL WORKER_ID IMAGE_TAG; do
  grep -Eq "^${key}=.+" "${ENV_FILE}" || die "missing required setting: ${key}"
done
grep -Eq '^IMAGE_TAG=[0-9a-f]{40}$' "${ENV_FILE}" \
  || die "IMAGE_TAG must be the full 40-character Git commit"
configured_image_tag=$(grep -E '^IMAGE_TAG=' "${ENV_FILE}")
configured_image_tag=${configured_image_tag#IMAGE_TAG=}
current_commit=$(git -C "${REPO_ROOT}" rev-parse HEAD) \
  || die "cannot resolve the repository HEAD"
[[ "${configured_image_tag}" == "${current_commit}" ]] \
  || die "IMAGE_TAG must exactly match the repository HEAD"
[[ -z "$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=normal)" ]] \
  || die "repository must be clean before building immutable images"

owner_uid=$(stat -c '%u' "${WORK_ROOT}")
[[ "${owner_uid}" == "10001" ]] \
  || die "${WORK_ROOT} must be owned by container UID 10001, found ${owner_uid}"

docker run --rm --user 10001:10001 \
  --volume "${WORK_ROOT}:/work" \
  "${CUDA_PROBE_IMAGE}" \
  bash -c 'probe=$(mktemp /work/.preflight.XXXXXX); trap '\''rm -f "${probe}"'\'' EXIT; printf "preflight\n" >"${probe}"' \
  || die "runtime root is not writable by container UID 10001"

docker compose --env-file "${ENV_FILE}" --file "${COMPOSE_FILE}" config --quiet \
  || die "Compose configuration is invalid"

printf 'PRECHECK_OK: host, GPU, data, runtime, and secret file are ready\n'
printf 'REMOTE_CHECK_PENDING: Supabase private bucket geoprocessing-results is checked after startup\n'
