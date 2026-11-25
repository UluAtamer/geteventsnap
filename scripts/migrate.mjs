import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { connect } from './mysql-client.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')
let client
let locked = false
try {
  console.log('[Veritabanı] MySQL bağlantısı kuruluyor...')
  client = await connect(process.env.DATABASE_URL, { multipleStatements: true })
  await client.query('SELECT 1')
  console.log('[Veritabanı] MySQL bağlantısı başarıyla kuruldu.')
  // Serialize migrations across concurrent application processes. MySQL DDL is not transactional.
  const lock = await client.query("SELECT GET_LOCK('eventsnap_migrate', 60) AS acquired")
  if (Number(lock.rows[0]?.acquired) !== 1) throw new Error('Migration kilidi alınamadı.')
  locked = true
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(191) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin')
  const directory = fileURLToPath(new URL('../db/mysql-migrations/', import.meta.url))
  for (const version of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
    const sql = await readFile(`${directory}/${version}`, 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version=?', [version])
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum) throw new Error('Uygulanan migration dosyası değiştirilmiş.')
      continue
    }
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations(version,checksum,applied_at) VALUES (?,?,?)', [version, checksum, new Date().toISOString()])
    console.log(`Migration uygulandı: ${version}`)
  }
  if (/^[a-f0-9-]{36}$/i.test(process.env.ADMIN_USER_ID || '')) {
    await client.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', [new Date().toISOString(), process.env.ADMIN_USER_ID])
  }
  console.log('[Veritabanı] Şema kontrolü tamamlandı; veritabanı hazır.')
} catch {
  console.error('Veritabanı kurulumu tamamlanamadı. DATABASE_URL ve veritabanı izinlerini kontrol edin.')
  process.exitCode = 1
} finally {
  if (locked) await client.query("SELECT RELEASE_LOCK('eventsnap_migrate')").catch(() => {})
  await client?.end().catch(() => {})
}
