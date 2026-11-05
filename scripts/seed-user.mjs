import pg from 'pg'
import { randomBytes, randomUUID, timingSafeEqual, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const deriveKey = promisify(scrypt)

export async function seedUser(client, environment = process.env) {
  if (environment.SEED_USER_ENABLED !== 'true') return 'disabled'
  const email = (environment.SEED_USER_EMAIL || '').trim().toLowerCase()
  const password = environment.SEED_USER_PASSWORD || ''
  const isAdmin = environment.SEED_USER_IS_ADMIN === 'true'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) {
    throw new Error('SEED_USER_EMAIL geçerli olmalı; SEED_USER_PASSWORD 12–128 karakter olmalı.')
  }

  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock(726283902)')
    const existing = await client.query('SELECT id, password_hash, is_admin FROM users WHERE lower(email)=$1 FOR UPDATE', [email])
    if (existing.rows.length) {
      const user = existing.rows[0]
      if (isAdmin && !user.is_admin) {
        // Promotion of an existing seed account also requires its current password.
        const [algorithm, salt, value] = user.password_hash.split(':')
        const expected = Buffer.from(value || '', 'hex')
        const actual = salt ? await deriveKey(password, salt, 64) : Buffer.alloc(0)
        if (algorithm !== 'scrypt' || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          throw new Error('Yönetici yetkisi için mevcut hesap parolası doğrulanamadı.')
        }
        await client.query('UPDATE users SET is_admin=TRUE WHERE id=$1', [user.id])
        await client.query('COMMIT')
        return 'promoted'
      }
      await client.query('COMMIT')
      return 'exists'
    }
    const salt = randomBytes(16).toString('hex')
    const hash = await deriveKey(password, salt, 64)
    const encoded = `scrypt:${salt}:${hash.toString('hex')}`
    const id = randomUUID()
    const now = new Date().toISOString()
    await client.query('INSERT INTO users(id,email,password_hash,created_at,is_admin) VALUES ($1,$2,$3,$4,$5)', [id, email, encoded, now, isAdmin])
    await client.query('INSERT INTO profiles(id,created_at) VALUES ($1,$2)', [id, now])
    await client.query('COMMIT')
    return 'created'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function main() {
  if (process.env.SEED_USER_ENABLED !== 'true') return
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL tanımlı değil; seed çalıştırılmadı.')
    process.exitCode = 1
    return
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  try {
    await client.connect()
    const result = await seedUser(client)
    console.log(result === 'created' ? 'İlk kurulum kullanıcısı oluşturuldu.' : result === 'promoted' ? 'İlk kurulum hesabına yönetici yetkisi verildi.' : 'İlk kurulum kullanıcısı mevcut; hesap değiştirilmedi.')
  } catch {
    console.error('İlk kurulum kullanıcısı oluşturulamadı. Seed environment ayarlarını ve veritabanı bağlantısını kontrol edin.')
    process.exitCode = 1
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
