import mysql from 'mysql2/promise'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { localDatabaseUrl } from './core'

// Applies db/mysql-migrations at server start. Hostinger starts the standalone server directly,
// so the npm "prestart" hook never runs there. Same rules as scripts/migrate.mjs.
export async function applyMigrations(directory = join(process.cwd(), 'db', 'mysql-migrations')) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')
  const connection = await mysql.createConnection({ uri: localDatabaseUrl(process.env.DATABASE_URL), multipleStatements: true, connectTimeout: 10000, charset: 'utf8mb4' })
  let locked = false
  try {
    const [lock] = await connection.query("SELECT GET_LOCK('eventsnap_migrate', 60) AS acquired") as [mysql.RowDataPacket[], unknown]
    if (Number(lock[0]?.acquired) !== 1) throw new Error('Migration kilidi alınamadı.')
    locked = true
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(191) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin')
    for (const version of (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
      const sql = await readFile(join(directory, version), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const [existing] = await connection.query('SELECT checksum FROM schema_migrations WHERE version=?', [version]) as [mysql.RowDataPacket[], unknown]
      if (existing.length) {
        if (existing[0].checksum !== checksum) throw new Error('Uygulanan migration dosyası değiştirilmiş.')
        continue
      }
      await connection.query(sql)
      await connection.query('INSERT INTO schema_migrations(version,checksum,applied_at) VALUES (?,?,?)', [version, checksum, new Date().toISOString()])
      console.log(`Migration uygulandı: ${version}`)
    }
    if (/^[a-f0-9-]{36}$/i.test(process.env.ADMIN_USER_ID || '')) {
      await connection.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?', [new Date().toISOString(), process.env.ADMIN_USER_ID])
    }
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('eventsnap_migrate')").catch(() => {})
    await connection.end().catch(() => {})
  }
}
