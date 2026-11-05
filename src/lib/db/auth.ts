import { isUiPreview } from '../ui-preview'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { database, publicUser, transaction, type User } from './core'

const scrypt = promisify(scryptCallback)
export const SESSION_COOKIE = 'eventsnap_session'
export const SESSION_SECONDS = 7 * 24 * 60 * 60
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64) as Buffer
  return `scrypt:${salt}:${hash.toString('hex')}`
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, value] = encoded.split(':')
  if (algorithm !== 'scrypt' || !salt || !value) return false
  const expected = Buffer.from(value, 'hex')
  const actual = await scrypt(password, salt, 64) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
export async function userForSession(token?: string): Promise<User | null> {
  if (isUiPreview() || !token || !/^[a-f0-9]{64}$/.test(token)) return null
  const row = await database().prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>? AND (u.banned_until IS NULL OR u.banned_until < ?)`).get(tokenHash(token), Date.now(), new Date().toISOString())
  return row ? publicUser(row) : null
}
export async function createSession(userId: string) {
  const db = database()
  const token = randomBytes(32).toString('hex')
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash(token), userId, Date.now() + SESSION_SECONDS * 1000)
  return token
}
export async function revokeSession(token?: string) {
  if (token) await database().prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token))
}
export async function register(email: string, password: string) {
  const id = randomUUID()
  const hash = await hashPassword(password)
  const now = new Date().toISOString()
  await transaction(async client => {
    await client.query('INSERT INTO users(id,email,password_hash,created_at,last_sign_in_at) VALUES ($1,$2,$3,$4,$5)', [id, email, hash, now, now])
    await client.query('INSERT INTO profiles(id,created_at) VALUES ($1,$2)', [id, now])
  })
  return publicUser({ id, email, created_at: now, last_sign_in_at: now })
}
export async function login(email: string, password: string) {
  const db = database()
  const row = await db.prepare('SELECT * FROM users WHERE email=?').get(email)
  // Perform the same expensive hash when the address is unknown.
  const dummy = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64)
  const valid = await verifyPassword(password, String(row?.password_hash || dummy))
  if (!valid || !row || (row.banned_until && String(row.banned_until) > new Date().toISOString())) return null
  await db.prepare('UPDATE users SET last_sign_in_at=? WHERE id=?').run(new Date().toISOString(), row.id)
  return publicUser(row)
}
export async function changePassword(user: User, currentPassword: string, password: string) {
  const db = database()
  const row = await db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)
  if (!row || !await verifyPassword(currentPassword, String(row.password_hash))) return false
  const hash = await hashPassword(password)
  await transaction(async client => {
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id])
    await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id])
  })
  return true
}

export const userAdmin = {
  async listUsers({ page = 1, perPage = 100 }: { page?: number; perPage?: number }) {
    const users = (await database().prepare('SELECT * FROM users ORDER BY created_at LIMIT ? OFFSET ?').all(Math.min(perPage, 1000), (page - 1) * perPage)).map(publicUser)
    return { data: { users }, error: null }
  },
  async getUserById(id: string) {
    const row = await database().prepare('SELECT * FROM users WHERE id=?').get(id)
    return { data: { user: row ? publicUser(row) : null }, error: null }
  },
  async updateUserById(id: string, options: { ban_duration: string }) {
    const until = options.ban_duration === 'none' ? null : '9999-12-31T00:00:00.000Z'
    const db = database()
    await db.prepare('UPDATE users SET banned_until=? WHERE id=?').run(until, id)
    await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
    return { error: null }
  },
  async deleteUser(id: string) {
    await database().prepare('DELETE FROM users WHERE id=?').run(id)
    return { error: null }
  },
}
