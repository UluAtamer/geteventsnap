#!/bin/sh
set -eu
echo '[Başlangıç] Environment ayarları doğrulanıyor.'
node scripts/validate-env.mjs
echo '[Başlangıç] Environment ayarları doğrulandı.'
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
node scripts/dating-cleanup.mjs &
echo '[Başlangıç] Web sunucusu başlatılıyor.'
exec node server.js
