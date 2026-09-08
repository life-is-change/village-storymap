#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT=/opt/village-storymap
COMPOSE_FILE=${REPO_ROOT}/linux/compose.yaml
ENV_FILE=/etc/village-platform/worker.env
SMOKE_ROOT=/work/linux-smoke
AOI_PATH=${SMOKE_ROOT}/aoi.geojson
INPUT_PATH=${SMOKE_ROOT}/building-input.tif
export COMPOSE_FILE

compose() {
  docker compose --env-file "${ENV_FILE}" "$@"
}

geo() {
  compose run --rm --no-deps geo-worker "$@"
}

compose ps

for service in facade-worker facade-ml facade-lama; do
  compose ps --status running "${service}" | grep -F "${service}" >/dev/null
done

compose exec -T facade-worker blender --version | grep -F "Blender 3.0.1"
compose exec -T facade-worker python -c \
  "import urllib.request; urllib.request.urlopen('http://facade-ml:8012/ready', timeout=170); urllib.request.urlopen('http://facade-lama:8013/ready', timeout=55)"
compose exec -T facade-worker python -c \
  "from village_processing.health import run_facade_health_checks; raise SystemExit(run_facade_health_checks())"
compose exec -T facade-worker python -c \
  'import os; from datetime import datetime, timezone; from supabase import create_client; c=create_client(os.environ["SUPABASE_URL"],os.environ["SUPABASE_SERVICE_ROLE_KEY"]); rows=c.table("worker_heartbeats").select("worker_id,last_seen_at").like("worker_id",os.environ["WORKER_ID"]+"-%").order("last_seen_at",desc=True).limit(1).execute().data; assert rows, "facade heartbeat missing"; age=(datetime.now(timezone.utc)-datetime.fromisoformat(rows[0]["last_seen_at"].replace("Z","+00:00"))).total_seconds(); assert age < 120, f"stale facade worker heartbeat: {age:.0f}s"'

compose exec -T building python3 -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8021/ready', timeout=10)"

compose exec -T building python3 -c \
  "import torch; assert torch.cuda.is_available(); from mmcv.ops import nms; print(torch.cuda.get_device_name(0))"

geo python -m village_processing health

geo python -c \
  'import json; from pathlib import Path; root=Path("/work/linux-smoke"); root.mkdir(parents=True, exist_ok=True); payload={"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[113.661,23.676],[113.665,23.676],[113.665,23.679],[113.661,23.679],[113.661,23.676]]]}}; (root/"aoi.geojson").write_text(json.dumps(payload), "utf-8")'

geo python -m village_processing crop-imagery \
  --catalog /app/server/config/villages.yaml \
  --village mibu \
  --aoi "${AOI_PATH}" \
  --output "${INPUT_PATH}"

geo python -m village_processing osm \
  --catalog /app/server/config/villages.yaml \
  --village mibu \
  --aoi "${AOI_PATH}" \
  --output "${SMOKE_ROOT}/osm"

geo python -c $'import json\nfrom pathlib import Path\nroot = Path("/work/linux-smoke/osm")\nfor name in ("roads.geojson", "waterways.geojson", "water_areas.geojson"):\n    payload = json.loads((root / name).read_text("utf-8"))\n    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):\n        raise SystemExit("invalid OSM output: " + name)'

geo python -c \
  'import json; from pathlib import Path; payload={"input_tif":"linux-smoke/building-input.tif","output_geojson":"linux-smoke/buildings.geojson","score_threshold":0.35}; Path("/work/linux-smoke/building-request.json").write_text(json.dumps(payload), "utf-8")'

geo python -c \
  'import httpx; response=httpx.post("http://building:8021/process", json={"manifest_path":"/work/linux-smoke/building-request.json"}, timeout=600); response.raise_for_status(); print(response.json())'

geo python -c $'import json\nfrom pathlib import Path\npayload = json.loads(Path("/work/linux-smoke/buildings.geojson").read_text("utf-8"))\nif payload.get("type") != "FeatureCollection":\n    raise SystemExit("invalid building output type")\nif not isinstance(payload.get("features"), list):\n    raise SystemExit("invalid building feature list")\nif not payload["features"]:\n    raise SystemExit("building smoke returned no features")\nprint("features=" + str(len(payload["features"])))'

printf 'VERIFY_OK: facade-worker, facade-ml, facade-lama, Blender 3.0.1, heartbeat, CUDA/MMCV, GIS, Supabase Storage, OSM, and building smoke passed\n'
