#!/bin/sh
set -eu
node scripts/validate-env.mjs
attempt=0
until node scripts/migrate.mjs; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ]; then
    echo 'Veritabanı hazır olmadığı için uygulama başlatılmadı.' >&2
    exit 1
  fi
  sleep 3
done
node scripts/seed-user.mjs
exec node server.js
