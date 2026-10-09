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
files=(features/geoprocessing/geoprocessing-panel.js rural_house_generator/app.js rural_house_generator/facade-queue-client.js rural_house_generator/index.html)
backup_dir=$(mktemp -d "$PWD/web-before-fix.XXXXXX")
for rel in "${files[@]}"; do
  mkdir -p -- "$backup_dir/$(dirname -- "$rel")"
  docker --context default cp "$target:/usr/share/nginx/html/$rel" "$backup_dir/$rel"
done
for rel in "${files[@]}"; do
  docker --context default cp "$rel" "$target:/usr/share/nginx/html/$rel"
done
echo "Updated four frontend files. Backup: $backup_dir"
echo "No restart or port change. Refresh the browser with Ctrl+Shift+R."
