import { randomBytes } from 'node:crypto'
import { database, publicUser, transaction } from './core'
import { tokenHash } from './auth'

export const VERIFICATION_MINUTES = 30

export async function issueEmailVerification(email: string) {
  return transaction(async client => {
    const { rows } = await client.query('SELECT id, email, email_verified_at, banned_until FROM users WHERE email=$1 FOR UPDATE', [email])
    const user = rows[0]
    if (!user || user.email_verified_at || (user.banned_until && user.banned_until > new Date().toISOString())) return null
    const now = Date.now()
    const recent = await client.query('SELECT created_at FROM email_verifications WHERE user_id=$1 AND created_at>$2 ORDER BY created_at DESC', [user.id, now - 3600000])
    if (recent.rows.length >= 5 || (recent.rows[0] && Number(recent.rows[0].created_at) > now - 60000)) return null
    await client.query('DELETE FROM email_verifications WHERE created_at<$1', [now - 86400000])
    const token = randomBytes(32).toString('hex')
    await client.query('INSERT INTO email_verifications(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', [tokenHash(token), user.id, now, now + VERIFICATION_MINUTES * 60000])
    return { email: user.email as string, token }
  })
}

export async function discardEmailVerification(token: string) {
  await database().prepare('DELETE FROM email_verifications WHERE token_hash=?').run(tokenHash(token))
}

export async function confirmEmail(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  return transaction(async client => {
    const { rows } = await client.query(`SELECT u.* FROM users u JOIN email_verifications v ON v.user_id=u.id
      WHERE v.token_hash=$1 AND v.expires_at>$2 FOR UPDATE OF u`, [tokenHash(token), Date.now()])
    const user = rows[0]
    if (!user || user.email_verified_at || (user.banned_until && user.banned_until > new Date().toISOString())) return null
    const now = new Date().toISOString()
    await client.query('UPDATE users SET email_verified_at=$1 WHERE id=$2', [now, user.id])
    await client.query('DELETE FROM email_verifications WHERE user_id=$1', [user.id])
    return publicUser({ ...user, email_verified_at: now })
  })
}
