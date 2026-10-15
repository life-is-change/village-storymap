#!/bin/bash
# Install official PostgreSQL client tools only, not a local database service.
set -Eeuo pipefail
set +x
trap 'echo "STOP: PostgreSQL client installation failed. Retain existing files and send the final error." >&2' ERR
if test -x /usr/lib/postgresql/17/bin/pg_dump && test -x /usr/lib/postgresql/17/bin/psql && \
   test -x /usr/lib/postgresql/17/bin/pg_dumpall && test -x /usr/lib/postgresql/17/bin/pg_restore; then
  /usr/lib/postgresql/17/bin/pg_dump --version
  exit 0
fi
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_CODENAME" = noble
sudo apt-get update
sudo apt-get install -y --no-install-recommends curl ca-certificates
key=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
sources=/etc/apt/sources.list.d/village-pgdg.sources
if ! apt-cache show postgresql-client-17 >/dev/null 2>&1; then
  sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
  if ! test -e "$key"; then
    key_temp=$(mktemp)
    curl --fail --show-error --silent --connect-timeout 15 --max-time 60 \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key_temp"
    sudo install -m 0644 "$key_temp" "$key"
    rm -- "$key_temp"
  fi
  if ! test -e "$sources"; then
    printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' \
      'Suites: noble-pgdg' "Architectures: $(dpkg --print-architecture)" 'Components: main' \
      "Signed-By: $key" | sudo tee "$sources" >/dev/null
  fi
fi
sudo apt-get update
sudo apt-get install -y --no-install-recommends postgresql-client-17
/usr/lib/postgresql/17/bin/pg_dump --version
echo DB_COPY_CLIENTS_READY
