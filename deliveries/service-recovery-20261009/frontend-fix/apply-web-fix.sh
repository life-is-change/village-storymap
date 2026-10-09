#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
target="village-platform-web-1"
project=$(docker --context default inspect "$target" --format '{{index .Config.Labels "com.docker.compose.project"}}')
service=$(docker --context default inspect "$target" --format '{{index .Config.Labels "com.docker.compose.service"}}')
if [[ "$project" != "village-platform" || "$service" != "web" ]]; then
  echo "STOP: target is not the village-platform web service." >&2
  exit 1
fi
sha256sum -c SHA256SUMS
backup_dir=$(mktemp -d "$PWD/web-before-fix.XXXXXX")
docker --context default cp "$target:/usr/share/nginx/html/features/geoprocessing/geoprocessing-panel.js" "$backup_dir/geoprocessing-panel.js"
docker --context default cp "$target:/usr/share/nginx/html/rural_house_generator/app.js" "$backup_dir/generator-app.js"
docker --context default cp features/geoprocessing/geoprocessing-panel.js "$target:/usr/share/nginx/html/features/geoprocessing/geoprocessing-panel.js"
docker --context default cp rural_house_generator/app.js "$target:/usr/share/nginx/html/rural_house_generator/app.js"
echo "Updated two scripts. Original scripts saved in: $backup_dir"
echo "No service restart or port change. Refresh the browser with Ctrl+Shift+R."
