import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
try {
  console.log('[Veritabanı] PostgreSQL bağlantısı kuruluyor...')
  await client.connect()
  await client.query('SELECT 1')
  console.log('[Veritabanı] PostgreSQL bağlantısı başarıyla kuruldu.')
  await client.query('BEGIN')
  // Serialize migrations across concurrent application replicas.
  await client.query('SELECT pg_advisory_xact_lock(726283901)')
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
  const directory = fileURLToPath(new URL('../db/migrations/', import.meta.url))
  for (const version of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
    const sql = await readFile(`${directory}/${version}`, 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [version])
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum) throw new Error('Uygulanan migration dosyası değiştirilmiş.')
      continue
    }
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)', [version, checksum])
    console.log(`Migration uygulandı: ${version}`)
  }
  await client.query('COMMIT')
  console.log('[Veritabanı] Şema kontrolü tamamlandı; veritabanı hazır.')
} catch {
  await client.query('ROLLBACK').catch(() => {})
  console.error('Veritabanı kurulumu tamamlanamadı. DATABASE_URL ve veritabanı izinlerini kontrol edin.')
  process.exitCode = 1
} finally { await client.end() }
