import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Production SQL runs against an isolated PostgreSQL engine, without a network or production credentials.
const directory = mkdtempSync(join(tmpdir(), 'eventsnap-private-'))
const pgliteUrl = pathToFileURL(resolve('node_modules/@electric-sql/pglite/dist/index.js')).href
writeFileSync(join(directory, 'pg-test-adapter.mjs'), `
  import { PGlite } from ${JSON.stringify(pgliteUrl)};
  export const engine = new PGlite();
  class Pool {
    on() {}
    async query(sql, args) { if (sql.includes(';') && !args?.length) { await engine.exec(sql); return { rows: [] }; } return engine.query(sql, args); }
    async connect() { return { query: this.query.bind(this), release() {} }; }
    async end() {}
  }
  export default { Pool, Client: Pool };
`)
process.env.DATABASE_URL = 'postgresql://unused/isolated-test'
process.env.EMAIL_VERIFICATION_REQUIRED = 'true'
writeFileSync(join(directory, 'verification-policy.mjs'), ts.transpileModule(readFileSync('src/lib/email-verification-policy.ts','utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
writeFileSync(join(directory, 'ui-preview.mjs'), ts.transpileModule(readFileSync('src/lib/ui-preview.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
for (const name of ['core', 'auth', 'email-verification']) {
  const source = readFileSync(resolve(`src/lib/db/${name}.ts`), 'utf8')
    .replace("from './core'", "from './core.mjs'")
    .replace("from './auth'", "from './auth.mjs'")
    .replace("from '../ui-preview'", "from './ui-preview.mjs'")
    .replace("from '../email-verification-policy'", "from './verification-policy.mjs'")
    .replace("from 'pg'", "from './pg-test-adapter.mjs'")
  writeFileSync(join(directory, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
}
const { engine } = await import(pathToFileURL(join(directory, 'pg-test-adapter.mjs')).href)
await engine.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)')
try {
  await engine.exec(readFileSync('db/migrations/001_initial.sql', 'utf8'))
  await engine.exec(readFileSync('db/migrations/002_admin_role.sql', 'utf8'))
  await engine.exec(readFileSync('db/migrations/003_drive_token_format.sql', 'utf8'))
  await engine.exec(readFileSync('db/migrations/004_email_verification.sql', 'utf8'))
  await engine.exec(readFileSync('db/migrations/005_restore_dating.sql', 'utf8'))
} catch (error) { throw new Error(error.message) }
const { database, Query, rpc, consumeRateLimit } = await import(pathToFileURL(join(directory, 'core.mjs')).href)
const { register: registerPending, login, createSession, userForSession, revokeSession, changePassword, userAdmin } = await import(pathToFileURL(join(directory, 'auth.mjs')).href)
const { issueEmailVerification, confirmEmail, discardEmailVerification } = await import(pathToFileURL(join(directory, 'email-verification.mjs')).href)
async function register(email, password) {
  const user = await registerPending(email, password)
  assert.ok(user)
  const now = new Date().toISOString()
  await database().prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now, user.id)
  return { ...user, email_verified_at: now }
}
globalThis.testMailbox = []
writeFileSync(join(directory, 'mail.mjs'), `
export function isMailConfigured() { return globalThis.testMailConfigured !== false; }
export async function sendVerificationEmail(email, token) {
  if (globalThis.testMailFailure) throw new Error('simulated SMTP failure');
  globalThis.testMailbox.push({ email, token });
}
`)
after(async () => { await database().close(); await engine.close(); rmSync(directory, { recursive: true, force: true }) })
const password = 'A-private-password-4321'
let alice, bob

test('passwords are salted hashes and session tokens never stored in plaintext', async () => {
  alice = await register('alice@example.test', password)
  bob = await register('bob@example.test', password)
  const users = await database().prepare('SELECT * FROM users').all()
  assert.ok(users.every(row => row.password_hash.startsWith('scrypt:') && !row.password_hash.includes(password)))
  assert.notEqual(users[0].password_hash, users[1].password_hash)
  assert.equal(await login(alice.email, 'wrong-password'), null)
  assert.equal((await login(alice.email, password)).id, alice.id)
  const token = await createSession(alice.id)
  assert.equal((await userForSession(token)).id, alice.id)
  assert.notEqual((await database().prepare('SELECT token_hash FROM sessions').get()).token_hash, token)
  await revokeSession(token)
  assert.equal(await userForSession(token), null)
})

test('owner scoping rejects anonymous and cross-account reads, inserts, changes and deletes', async () => {
  const owned = { owner_id: alice.id, title: 'Private name', event_date: '2026-11-05', slug: 'random-secret-slug' }
  const created = await new Query('events', alice.id, false).insert(owned).select('*').single()
  assert.equal(created.error, null)
  assert.equal((await new Query('events', bob.id, false).select('*')).data.length, 0)
  assert.ok((await new Query('events', null, false).select('*')).error)
  assert.ok((await new Query('events', bob.id, false).insert({ ...owned, slug: 'forged' })).error)
  assert.equal((await new Query('events', bob.id, false).update({ title: 'stolen' }).eq('id', created.data.id)).data.length, 0)
  assert.equal((await new Query('events', bob.id, false).delete().eq('id', created.data.id)).data.length, 0)
  assert.equal((await new Query('events', alice.id, false).select('*').single()).data.title, owned.title)
  assert.ok((await new Query('event_drive_connections', alice.id, false).select('*')).error)
  assert.ok((await rpc('get_owner_event_upload_stats', {}, null)).error)
  assert.ok((await rpc('get_public_event_details', { event_slug: owned.slug }, null)).error)
})

test('password changes, bans and account deletion revoke sessions', async () => {
  const token = await createSession(bob.id)
  assert.equal(await changePassword(bob, 'incorrect', password + '!'), false)
  assert.equal(await changePassword(bob, password, password + '!'), true)
  assert.equal(await userForSession(token), null)
  assert.equal(await login(bob.email, password), null)
  const second = await createSession(bob.id)
  await userAdmin.updateUserById(bob.id, { ban_duration: '876000h' })
  assert.equal(await userForSession(second), null)
  assert.equal(await login(bob.email, password + '!'), null)
  await userAdmin.deleteUser(bob.id)
  assert.equal(await database().prepare('SELECT id FROM profiles WHERE id=?').get(bob.id), undefined)
})

test('rate limit and CSV locks enforce limits and lease ownership', async () => {
  assert.equal(await consumeRateLimit('test-bucket', 1), true)
  assert.equal(await consumeRateLimit('test-bucket', 1), false)
  const event = await database().prepare('SELECT id FROM events').get()
  const args = { p_event_id: event.id, p_lock_token: 'lock-a', p_lease_seconds: 90 }
  assert.equal((await rpc('acquire_event_upload_csv_lock', args, null, true)).data, true)
  assert.equal((await rpc('acquire_event_upload_csv_lock', { ...args, p_lock_token: 'lock-b' }, null, true)).data, false)
  await rpc('release_event_upload_csv_lock', { ...args, p_lock_token: 'lock-b' }, null, true)
  assert.equal((await rpc('acquire_event_upload_csv_lock', args, null, true)).data, false)
  await rpc('release_event_upload_csv_lock', args, null, true)
  assert.equal((await rpc('acquire_event_upload_csv_lock', args, null, true)).data, true)
})

test('account deletion cascades events, private covers, Drive tokens and upload records', async () => {
  const event = await database().prepare('SELECT id FROM events').get()
  const drive = await new Query('event_drive_connections', null, true).upsert({ event_id: event.id, owner_id: alice.id, encrypted_refresh_token: 'encrypted', drive_folder_id: 'private-folder', drive_folder_url: 'private-url' })
  assert.equal(drive.error, null)
  const upload = await new Query('uploads_meta', null, true).upsert({ event_id: event.id, drive_file_id: 'file-id', guest_hash: 'private-hash', file_size: 100, mime_type: 'image/jpeg' }, { onConflict: 'drive_file_id', ignoreDuplicates: true })
  assert.equal(upload.error, null)
  const duplicate = await new Query('uploads_meta', null, true).upsert({ event_id: event.id, drive_file_id: 'file-id', file_size: 100, mime_type: 'image/jpeg' }, { onConflict: 'drive_file_id', ignoreDuplicates: true })
  assert.equal(duplicate.error, null)
  assert.equal(Number((await database().prepare('SELECT count(*) AS count FROM uploads_meta').get()).count), 1)
  const stats = await rpc('get_owner_event_upload_stats', {}, alice.id)
  assert.equal(Number(stats.data[0].file_count), 1)
  await database().prepare('INSERT INTO covers VALUES (?,?,?,?)').run('private-cover', alice.id, 'image/jpeg', Buffer.from('photo'))
  await userAdmin.deleteUser(alice.id)
  for (const table of ['events','profiles','event_drive_connections','uploads_meta','covers','sessions','csv_locks']) {
    assert.equal(Number((await database().prepare(`SELECT count(*) AS count FROM ${table}`).get()).count), 0, table)
  }
})

async function loadRoute(file, name) {
  const serverUrl = pathToFileURL(resolve('node_modules/next/server.js')).href
  const source = readFileSync(file, 'utf8')
    .replace("from 'next/server'", `from '${serverUrl}'`)
    .replace("from '@/lib/db/core'", "from './core.mjs'")
    .replace("from '@/lib/ui-preview'", "from './ui-preview.mjs'")
    .replace("from '@/lib/email-verification-policy'", "from './verification-policy.mjs'")
    .replace("from '@/lib/db/auth'", "from './auth.mjs'")
    .replace("from '@/lib/db/email-verification'", "from './email-verification.mjs'")
    .replace("from '@/lib/mail'", "from './mail.mjs'")
    .replace("from '@/lib/dating-server'", "from './dating-server.mjs'")
    .replace("from '@/lib/request-origin'", "from './origin.mjs'")
  writeFileSync(join(directory, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  return import(pathToFileURL(join(directory, `${name}.mjs`)).href)
}

test('auth and private-file endpoints enforce runtime origin, cookies, identity and cache isolation', async () => {
  const { NextRequest } = await import('next/server.js')
  process.env.SITE_URL = 'https://private.example.test'
  process.env.NODE_ENV = 'production'
  writeFileSync(join(directory, 'origin.mjs'), ts.transpileModule(readFileSync('src/lib/request-origin.ts','utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  const auth = await loadRoute('src/app/api/auth/[action]/route.ts', 'auth-route')
  const covers = await loadRoute('src/app/api/covers/[...path]/route.ts', 'cover-route')
  const authRequest = (action, body, origin = process.env.SITE_URL) => new NextRequest(`http://internal-container:3000/api/auth/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const context = action => ({ params: Promise.resolve({ action }) })
  const rejected = await auth.POST(authRequest('signup', { email: 'route@example.test', password }, 'https://untrusted.example.test'), context('signup'))
  assert.equal(rejected.status, 403)
  const signup = await auth.POST(authRequest('signup', { email: 'route@example.test', password }), context('signup'))
  assert.equal(signup.status, 200)
  const signupPayload = await signup.json()
  assert.equal(signupPayload.data.session, null)
  assert.equal(signup.headers.get('set-cookie'), null)
  assert.equal(await login('route@example.test', password), null)
  const mail = globalThis.testMailbox.find(item => item.email === 'route@example.test')
  assert.ok(mail)
  const response = await auth.POST(authRequest('verify-email', { token: mail.token }), context('verify-email'))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.ok(!JSON.stringify(payload).includes('password_hash'))
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /Secure/i)
  assert.match(cookie, /SameSite=lax/i)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const ownerCookie = cookie.split(';')[0]
  const owner = payload.data.user
  const stranger = await register('stranger@example.test', password)
  const strangerCookie = `eventsnap_session=${await createSession(stranger.id)}`
  const path = `${owner.id}/12345678-1234-1234-1234-123456789abc.png`
  const coverContext = { params: Promise.resolve({ path: path.split('/') }) }
  const fileRequest = (method, cookieValue, body, origin = process.env.SITE_URL) => new NextRequest(`http://internal-container:3000/api/covers/${path}`, { method, headers: { origin, cookie: cookieValue || '', 'content-type': 'image/png' }, ...(body ? { body } : {}) })
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])
  assert.equal((await covers.PUT(fileRequest('PUT', ownerCookie, png), coverContext)).status, 200)
  const privateFile = await covers.GET(fileRequest('GET', ownerCookie), coverContext)
  assert.equal(privateFile.status, 200)
  assert.match(privateFile.headers.get('cache-control'), /private.*no-store/)
  assert.deepEqual(Buffer.from(await privateFile.arrayBuffer()), png)
  for (const unauthorizedCookie of ['', strangerCookie]) {
    const denied = await covers.GET(fileRequest('GET', unauthorizedCookie), coverContext)
    assert.equal(denied.status, 404)
    assert.equal((await denied.arrayBuffer()).byteLength, 0)
  }
  assert.equal((await covers.DELETE(fileRequest('DELETE', strangerCookie), coverContext)).status, 403)
  assert.equal((await covers.PUT(fileRequest('PUT', ownerCookie, png, 'https://untrusted.example.test'), coverContext)).status, 403)
  assert.equal((await covers.PUT(fileRequest('PUT', ownerCookie, Buffer.from('<svg></svg>')), coverContext)).status, 400)
  const anonymousUser = await auth.GET(new NextRequest('http://internal-container:3000/api/auth/user'), context('user'))
  assert.equal((await anonymousUser.json()).data.user, null)
  const wrongPassword = await auth.POST(authRequest('login', { email: owner.email, password: password + '-wrong' }), context('login'))
  assert.equal(wrongPassword.status, 401)
  process.env.NODE_ENV = 'test'
})

test('guest HTML and client props omit event names, addresses, email and private covers', async () => {
  const { default: React } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const owner = await register('hidden-owner@example.test', password)
  const privateDetails = {
    owner_id: owner.id, title: 'SECRET EVENT NAME', event_address: 'SECRET HOME ADDRESS',
    welcome_message: 'SECRET PERSONAL NOTE', event_date: '2026-11-05', slug: 'unpredictable-invitation-token',
    cover_image_url: `/api/covers/${owner.id}/12345678-1234-1234-1234-123456789abc.png`,
  }
  await new Query('events', owner.id, false).insert(privateDetails)
  const windowSource = readFileSync('src/lib/event-upload-window.ts', 'utf8')
  writeFileSync(join(directory, 'window.mjs'), ts.transpileModule(windowSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  let page = readFileSync('src/app/e/[slug]/page.tsx', 'utf8')
    .replace("import { notFound } from 'next/navigation'", "function notFound() { throw new Error('not found') }")
    .replace("import DatingModule from '@/components/events/DatingModule'", "function DatingModule(props) { return React.createElement('div', { 'data-dating-enabled': props.enabled }) }")
    .replace("import GuestUploadForm from '@/components/events/GuestUploadForm'", "function GuestUploadForm(props) { return React.createElement('div', { 'data-client-props': JSON.stringify(props) }) }")
    .replace("import { getGuestUploadLimits } from '@/lib/guest-upload'", "function getGuestUploadLimits() { return { photoBytes: 10, videoBytes: 20 } }")
    .replace("from '@/lib/event-upload-window'", "from './window.mjs'")
    .replace("from '@/lib/db/core'", "from './core.mjs'")
    .replace("from '@/lib/ui-preview'", "from './ui-preview.mjs'")
    .replace("from '@/lib/email-verification-policy'", "from './verification-policy.mjs'")
    .replace("import styles from './event.module.css'", "const styles = {}")
  page = `import React from '${pathToFileURL(resolve('node_modules/react/index.js')).href}'\n` + page
  writeFileSync(join(directory, 'guest-page.mjs'), ts.transpileModule(page, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText)
  const module = await import(pathToFileURL(join(directory, 'guest-page.mjs')).href)
  const html = renderToStaticMarkup(await module.default({ params: Promise.resolve({ slug: privateDetails.slug }) }))
  for (const secret of [owner.email, owner.id, privateDetails.title, privateDetails.event_address, privateDetails.welcome_message, privateDetails.cover_image_url]) {
    assert.ok(!html.includes(secret), `guest output must omit ${secret}`)
    assert.ok(!JSON.stringify(module.metadata).includes(secret))
  }
})

test('deployment migration runner is repeatable and tracks the applied schema', async () => {
  mkdirSync(join(directory, 'scripts'))
  mkdirSync(join(directory, 'db', 'migrations'), { recursive: true })
  for (const version of ['001_initial.sql', '002_admin_role.sql', '003_drive_token_format.sql', '004_email_verification.sql', '005_restore_dating.sql']) {
    writeFileSync(join(directory, 'db', 'migrations', version), readFileSync(`db/migrations/${version}`))
  }
  const source = readFileSync('scripts/migrate.mjs', 'utf8').replace("from 'pg'", "from '../pg-test-adapter.mjs'")
  writeFileSync(join(directory, 'scripts', 'migrate.mjs'), source)
  const migrationUrl = pathToFileURL(join(directory, 'scripts', 'migrate.mjs')).href
  const messages = []
  const originalLog = console.log
  console.log = message => messages.push(String(message))
  try {
    await import(migrationUrl + '?first')
    await import(migrationUrl + '?second')
  } finally { console.log = originalLog }
  assert.equal(messages.filter(message => message === '[Veritabanı] PostgreSQL bağlantısı başarıyla kuruldu.').length, 2)
  assert.equal(messages.filter(message => message === '[Veritabanı] Şema kontrolü tamamlandı; veritabanı hazır.').length, 2)
  assert.ok(!messages.join('\n').includes(process.env.DATABASE_URL))
  assert.equal(process.exitCode || 0, 0)
  const versions = await database().prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  assert.deepEqual(versions.map(row => row.version), ['001_initial.sql', '002_admin_role.sql', '003_drive_token_format.sql', '004_email_verification.sql', '005_restore_dating.sql'])
})

test('first-deployment seed is opt-in, hashed and never resets an existing account password', async () => {
  const { seedUser } = await import('../scripts/seed-user.mjs')
  assert.equal(await seedUser({ query() { throw new Error('No database call expected') } }, {}), 'disabled')
  const settings = { SEED_USER_ENABLED: 'true', SEED_USER_EMAIL: 'Bootstrap@Example.Test', SEED_USER_PASSWORD: 'Temporary-bootstrap-4321' }
  const client = { query: engine.query.bind(engine) }
  await assert.rejects(seedUser(client, { ...settings, SEED_USER_PASSWORD: 'short' }))
  assert.equal(await seedUser(client, settings), 'created')
  const user = await login('bootstrap@example.test', settings.SEED_USER_PASSWORD)
  assert.ok(user)
  const row = await database().prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)
  assert.ok(row.password_hash.startsWith('scrypt:'))
  assert.ok(!row.password_hash.includes(settings.SEED_USER_PASSWORD))
  const oldToken = await createSession(user.id)
  const newPassword = 'Changed-bootstrap-password-9876'
  assert.equal(await changePassword(user, settings.SEED_USER_PASSWORD, newPassword), true)
  assert.equal(await userForSession(oldToken), null)
  assert.equal(await seedUser(client, settings), 'exists')
  assert.equal(await login(user.email, settings.SEED_USER_PASSWORD), null)
  assert.equal((await login(user.email, newPassword)).id, user.id)
  assert.equal(await seedUser(client, { ...settings, SEED_USER_ENABLED: 'false' }), 'disabled')
  assert.equal((await login(user.email, newPassword)).id, user.id)
  const count = await database().prepare('SELECT count(*) AS count FROM users WHERE email=?').get(user.email)
  assert.equal(Number(count.count), 1)
})

test('seed administrator role requires explicit opt-in and the current password for promotion', async () => {
  const { seedUser } = await import('../scripts/seed-user.mjs')
  const client = { query: engine.query.bind(engine) }
  const config = { SEED_USER_ENABLED: 'true', SEED_USER_IS_ADMIN: 'true', SEED_USER_EMAIL: 'first-admin@example.test', SEED_USER_PASSWORD: password }
  assert.equal(await seedUser(client, config), 'created')
  const admin = await login(config.SEED_USER_EMAIL, password)
  assert.equal(admin.is_admin, true)
  await seedUser(client, { ...config, SEED_USER_ENABLED: 'false' })
  assert.equal((await userForSession(await createSession(admin.id))).is_admin, true)

  const member = await register('promote-member@example.test', password)
  assert.equal(member.is_admin, false)
  await assert.rejects(seedUser(client, { ...config, SEED_USER_EMAIL: member.email, SEED_USER_PASSWORD: 'Incorrect-password-1234' }))
  assert.equal((await login(member.email, password)).is_admin, false)
  const before = await database().prepare('SELECT password_hash FROM users WHERE id=?').get(member.id)
  assert.equal(await seedUser(client, { ...config, SEED_USER_EMAIL: member.email }), 'promoted')
  assert.equal((await login(member.email, password)).is_admin, true)
  const after = await database().prepare('SELECT password_hash FROM users WHERE id=?').get(member.id)
  assert.equal(after.password_hash, before.password_hash)
})

test('admin visibility and server authorization use the same trusted role or explicit UUID', async () => {
  writeFileSync(join(directory, 'admin-access.mjs'), ts.transpileModule(readFileSync('src/lib/admin-access.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  const { isAdminUser } = await import(pathToFileURL(join(directory, 'admin-access.mjs')).href)
  assert.equal(isAdminUser(null, ''), false)
  assert.equal(isAdminUser({ id: 'normal', is_admin: false }, ''), false)
  assert.equal(isAdminUser({ id: 'admin', is_admin: true }, ''), true)
  assert.equal(isAdminUser({ id: 'configured', is_admin: false }, 'configured'), true)
  assert.equal(isAdminUser({ id: 'normal', is_admin: false }, 'configured'), false)

  const source = readFileSync('src/lib/admin-auth.ts', 'utf8')
    .replace("import 'server-only'", '')
    .replace("from '@/lib/admin-access'", "from './admin-access.mjs'")
    .replace("import { redirect } from 'next/navigation'", "function redirect(path) { throw new Error('REDIRECT:' + path) }")
    .replace("import { createClient } from '@/lib/db/server'", "async function createClient() { return { auth: { async getUser() { return { data: { user: globalThis.adminGuardUser }, error: null } } } } }")
  writeFileSync(join(directory, 'admin-guard.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
  const { requireAdmin } = await import(pathToFileURL(join(directory, 'admin-guard.mjs')).href)
  globalThis.adminGuardUser = null
  await assert.rejects(requireAdmin(), /REDIRECT:\/giris/)
  globalThis.adminGuardUser = { id: 'normal', is_admin: false }
  await assert.rejects(requireAdmin(), /REDIRECT:\/dashboard/)
  globalThis.adminGuardUser = { id: 'admin', is_admin: true }
  assert.equal((await requireAdmin()).id, 'admin')
  delete globalThis.adminGuardUser
})

test('public registration cannot assign itself an administrator role', async () => {
  const { NextRequest } = await import('next/server.js')
  const auth = await loadRoute('src/app/api/auth/[action]/route.ts', 'signup-role-route')
  const request = new NextRequest('http://internal-container:3000/api/auth/signup', {
    method: 'POST', headers: { origin: process.env.SITE_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'role-injection@example.test', password, is_admin: true, role: 'admin' }),
  })
  const response = await auth.POST(request, { params: Promise.resolve({ action: 'signup' }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.user, null)
  const row = await database().prepare('SELECT is_admin,email_verified_at FROM users WHERE email=?').get('role-injection@example.test')
  assert.equal(row.is_admin, false)
  assert.equal(row.email_verified_at, null)
  assert.equal(await login('role-injection@example.test', password), null)
})

test('legacy Drive migration requests reauthorization while preserving folders and current connections', async () => {
  const owner = await register('drive-upgrade@example.test', password)
  const events = []
  for (const slug of ['legacy-drive', 'current-drive']) {
    const result = await new Query('events', owner.id, false).insert({ owner_id: owner.id, title: 'Private event', event_date: '2026-11-05', slug }).select('*').single()
    assert.equal(result.error, null)
    events.push(result.data)
  }
  for (let index = 0; index < events.length; index++) {
    const result = await new Query('event_drive_connections', null, true).upsert({
      event_id: events[index].id, owner_id: owner.id,
      encrypted_refresh_token: index ? 'v2.iv.tag.ciphertext' : 'legacy-iv.legacy-tag.legacy-ciphertext',
      drive_folder_id: `private-folder-${index}`, drive_folder_url: `private-folder-url-${index}`,
    })
    assert.equal(result.error, null)
  }
  await engine.exec(readFileSync('db/migrations/003_drive_token_format.sql', 'utf8'))
  const legacy = await database().prepare('SELECT * FROM event_drive_connections WHERE event_id=?').get(events[0].id)
  const current = await database().prepare('SELECT * FROM event_drive_connections WHERE event_id=?').get(events[1].id)
  assert.equal(legacy.connection_status, 'reauth_required')
  assert.equal(legacy.drive_folder_id, 'private-folder-0')
  assert.equal(legacy.drive_folder_url, 'private-folder-url-0')
  assert.equal(current.connection_status, 'connected')
})

test('email verification gates sessions and accepts a hashed, unexpired token only once', async () => {
  const user = await registerPending('pending-confirmation@example.test', password)
  assert.ok(user)
  assert.equal(user.email_verified_at, null)
  assert.equal(await login(user.email, password), null)
  await assert.rejects(createSession(user.id))
  const verification = await issueEmailVerification(user.email)
  assert.ok(verification)
  const stored = await database().prepare('SELECT token_hash FROM email_verifications WHERE user_id=?').get(user.id)
  assert.notEqual(stored.token_hash, verification.token)
  assert.equal(await issueEmailVerification(user.email), null)
  assert.equal(await confirmEmail('invalid'), null)
  const verified = await confirmEmail(verification.token)
  assert.equal(verified.id, user.id)
  assert.ok(verified.email_verified_at)
  assert.equal(await confirmEmail(verification.token), null)
  assert.equal((await login(user.email, password)).id, user.id)
  assert.equal((await userForSession(await createSession(user.id))).id, user.id)
  assert.equal(await issueEmailVerification(user.email), null)
})

test('expired tokens are rejected and resend quotas cannot be bypassed by requesting repeatedly', async () => {
  const user = await registerPending('resend-confirmation@example.test', password)
  const first = await issueEmailVerification(user.email)
  await database().prepare('UPDATE email_verifications SET expires_at=? WHERE user_id=?').run(Date.now() - 1000, user.id)
  assert.equal(await confirmEmail(first.token), null)
  for (let index = 1; index < 5; index++) {
    await database().prepare('UPDATE email_verifications SET created_at=? WHERE user_id=?').run(Date.now() - 61000, user.id)
    assert.ok(await issueEmailVerification(user.email))
  }
  await database().prepare('UPDATE email_verifications SET created_at=? WHERE user_id=?').run(Date.now() - 61000, user.id)
  assert.equal(await issueEmailVerification(user.email), null)
  await discardEmailVerification(first.token)
  assert.equal(await confirmEmail(first.token), null)
})

test('missing SMTP blocks signup without creating an account; delivery failure can be retried', async () => {
  const { NextRequest } = await import('next/server.js')
  const auth = await loadRoute('src/app/api/auth/[action]/route.ts', 'mail-failure-route')
  const request = (action, email) => new NextRequest(`http://internal-container:3000/api/auth/${action}`, { method: 'POST', headers: { origin: process.env.SITE_URL, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const context = action => ({ params: Promise.resolve({ action }) })
  globalThis.testMailConfigured = false
  try {
    assert.equal((await auth.POST(request('signup', 'no-smtp@example.test'), context('signup'))).status, 503)
    assert.equal(await database().prepare('SELECT id FROM users WHERE email=?').get('no-smtp@example.test'), undefined)
  } finally { globalThis.testMailConfigured = true }
  globalThis.testMailFailure = true
  const messages = []
  const original = console.error
  console.error = message => messages.push(String(message))
  try {
    assert.equal((await auth.POST(request('signup', 'smtp-failed@example.test'), context('signup'))).status, 503)
  } finally { globalThis.testMailFailure = false; console.error = original }
  assert.ok(!messages.join('').includes('smtp-failed@example.test'))
  const pending = await database().prepare('SELECT id FROM users WHERE email=?').get('smtp-failed@example.test')
  assert.equal(Number((await database().prepare('SELECT count(*) AS count FROM email_verifications WHERE user_id=?').get(pending.id)).count), 0)
  assert.equal((await auth.POST(request('resend-verification', 'smtp-failed@example.test'), context('resend-verification'))).status, 200)
  assert.ok(globalThis.testMailbox.some(mail => mail.email === 'smtp-failed@example.test'))
  const unknown = await auth.POST(request('resend-verification', 'unknown-account@example.test'), context('resend-verification'))
  assert.equal(unknown.status, 200)
  assert.ok(!(await unknown.text()).includes('unknown-account@example.test'))
})

test('restored dating isolates events, protects photos and releases contacts only after mutual matching', async () => {
  const windowSource = readFileSync('src/lib/event-upload-window.ts','utf8')
  writeFileSync(join(directory,'window.mjs'),ts.transpileModule(windowSource,{ compilerOptions: { target: ts.ScriptTarget.ES2022,module: ts.ModuleKind.ES2022 } }).outputText)
  const serviceSource = readFileSync('src/lib/dating-server.ts','utf8').replace("import 'server-only'",'')
    .replace("from '@/lib/db/core'","from './core.mjs'").replace("from '@/lib/event-upload-window'","from './window.mjs'")
  writeFileSync(join(directory,'dating-server.mjs'),ts.transpileModule(serviceSource,{ compilerOptions: { target: ts.ScriptTarget.ES2022,module: ts.ModuleKind.ES2022 } }).outputText)
  const service = await import(pathToFileURL(join(directory,'dating-server.mjs')).href)
  const { getIstanbulDate } = await import(pathToFileURL(join(directory,'window.mjs')).href)
  const route = await loadRoute('src/app/api/events/[slug]/dating/[action]/route.ts','dating-route')
  const photos = await loadRoute('src/app/api/events/[slug]/dating/photos/[id]/route.ts','dating-photos-route')
  const reports = await loadRoute('src/app/api/dashboard/dating/reports/route.ts','dating-reports-route')
  const owner = await register('dating-owner@example.test',password)
  const outsider = await register('dating-outsider@example.test',password)
  const event = (await new Query('events',owner.id,false).insert({ owner_id: owner.id,title: 'Private wedding',event_date: getIstanbulDate(),slug: 'private-dating-event',dating_enabled: true }).select('*').single()).data
  const otherEvent = (await new Query('events',outsider.id,false).insert({ owner_id: outsider.id,title: 'Other private event',event_date: getIstanbulDate(),slug: 'other-dating-event',dating_enabled: true }).select('*').single()).data
  assert.equal(event.dating_enabled,true)
  const tokens = ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])
  const profileRequest = (target,token,name,options = {}) => {
    const form = new FormData()
    for (const [key,value] of Object.entries({ firstName: name,age: '25',bio: 'Hello',consent: 'true',contactType: 'phone',contactValue: '+905551234567',...options })) form.set(key,value)
    form.set('photo',new File([png],'portrait.png',{ type: 'image/png' }))
    return new Request(`http://internal-container:3000/api/events/${target.slug}/dating/profile`,{ method: 'POST',headers: { authorization: `Bearer ${token}`,origin: process.env.SITE_URL },body: form })
  }
  await assert.rejects(service.createDatingProfile(profileRequest(event,tokens[0],'A',{ age: '17' }),event,tokens[0]))
  await assert.rejects(service.createDatingProfile(profileRequest(event,tokens[0],'A',{ consent: 'false' }),event,tokens[0]))
  const a = await service.createDatingProfile(profileRequest(event,tokens[0],'Participant A'),event,tokens[0])
  const b = await service.createDatingProfile(profileRequest(event,tokens[1],'Participant B'),event,tokens[1])
  const c = await service.createDatingProfile(profileRequest(otherEvent,tokens[2],'Other event participant'),otherEvent,tokens[2])
  const request = (action,token) => new Request(`http://internal-container:3000/api/events/${event.slug}/dating/${action}`,{ headers: token ? { authorization: `Bearer ${token}` } : {} })
  const context = action => ({ params: Promise.resolve({ slug: event.slug,action }) })
  assert.equal((await route.GET(request('feed'),context('feed'))).status,401)
  assert.equal((await route.GET(request('feed',tokens[2]),context('feed'))).status,401)
  const session = await route.GET(request('session',tokens[0]),context('session'))
  assert.equal(session.status,200)
  assert.match(session.headers.get('set-cookie'),/HttpOnly/i)
  const participantCookie = session.headers.get('set-cookie').split(';')[0]
  const photoContext = { params: Promise.resolve({ slug: event.slug,id: b.id }) }
  const photoRequest = cookie => new Request(`http://internal-container:3000/api/events/${event.slug}/dating/photos/${b.id}`,{ headers: { cookie: cookie || '' } })
  assert.equal((await photos.GET(photoRequest(),photoContext)).status,404)
  assert.equal((await photos.GET(photoRequest(`eventsnap_dating=${tokens[2]}`),photoContext)).status,404)
  const privatePhoto = await photos.GET(photoRequest(participantCookie),photoContext)
  assert.equal(privatePhoto.status,200)
  assert.match(privatePhoto.headers.get('cache-control'),/private, no-store/)
  assert.deepEqual(Buffer.from(await privatePhoto.arrayBuffer()),png)
  const initialFeed = await service.datingFeed(event,a,event.slug)
  assert.equal(initialFeed.candidates.length,1)
  assert.equal(initialFeed.candidates[0].firstName,'Participant B')
  assert.ok(!JSON.stringify(initialFeed).includes('+905551234567'))
  assert.ok(!JSON.stringify(initialFeed).includes('guest_token_hash'))
  assert.ok(!JSON.stringify(initialFeed).includes('photo_content'))
  await assert.rejects(service.interact(event,a,c.id,'like',event.slug))
  assert.equal((await service.interact(event,a,b.id,'like',event.slug)).matched,false)
  assert.equal((await service.datingFeed(event,a,event.slug)).liked[0].contact,undefined)
  assert.equal((await service.interact(event,b,a.id,'like',event.slug)).matched,true)
  assert.equal((await service.datingFeed(event,a,event.slug)).matches[0].contact.value,'+905551234567')
  await service.protectParticipant(event,a,b.id,'report','Inappropriate profile')
  const ownerCookie = `eventsnap_session=${await createSession(owner.id)}`
  const outsiderCookie = `eventsnap_session=${await createSession(outsider.id)}`
  const reportRequest = cookie => new Request(`http://internal-container:3000/api/dashboard/dating/reports?eventId=${event.id}`,{ headers: { cookie } })
  assert.equal((await reports.GET(reportRequest(outsiderCookie))).status,404)
  const ownerReports = await reports.GET(reportRequest(ownerCookie))
  assert.equal(ownerReports.status,200)
  const report = (await ownerReports.json()).reports[0]
  assert.equal(report.profile.name,'Participant B')
  await service.protectParticipant(event,a,b.id,'block','')
  const blocked = await service.datingFeed(event,a,event.slug)
  assert.equal(blocked.matches.length,0)
  assert.equal(blocked.liked.length,0)
  assert.equal((await service.datingFeed(event,b,event.slug)).candidates.length,0)
  assert.equal((await photos.GET(photoRequest(participantCookie),photoContext)).status,404)
  await assert.rejects(service.interact(event,b,a.id,'like',event.slug))
  const removeReport = new Request('http://internal-container:3000/api/dashboard/dating/reports',{ method: 'POST',headers: { origin: process.env.SITE_URL,cookie: ownerCookie,'content-type': 'application/json' },body: JSON.stringify({ eventId: event.id,reportId: report.id,action: 'remove' }) })
  assert.equal((await reports.POST(removeReport)).status,200)
  assert.equal(await service.getGuestProfile(event.id,tokens[1]),undefined)
  assert.equal((await photos.GET(photoRequest(ownerCookie),photoContext)).status,404)
  await new Query('events',owner.id,false).update({ dating_enabled: false }).eq('id',event.id)
  assert.equal((await route.GET(request('feed',tokens[0]),context('feed'))).status,403)
  const ownDelete = new Request(`http://internal-container:3000/api/events/${event.slug}/dating/safety`,{ method: 'DELETE',headers: { origin: process.env.SITE_URL,authorization: `Bearer ${tokens[0]}` } })
  assert.equal((await route.DELETE(ownDelete,context('safety'))).status,200)
  assert.equal(await service.getGuestProfile(event.id,tokens[0]),undefined)
  await database().prepare('UPDATE events SET event_date=? WHERE id=?').run('2000-01-01',otherEvent.id)
  await service.cleanupExpiredDating()
  assert.equal(await service.getGuestProfile(otherEvent.id,tokens[2]),undefined)
  assert.equal(Number((await database().prepare('SELECT count(*) AS count FROM dating_likes WHERE event_id=?').get(event.id)).count),0)
})

test('disabled verification permits signup and pending-account login without SMTP, then enforces confirmation when reenabled', async () => {
  const { NextRequest } = await import('next/server.js')
  const auth = await loadRoute('src/app/api/auth/[action]/route.ts','verification-disabled-route')
  const email = 'verification-disabled@example.test'
  const request = action => new NextRequest(`http://internal-container:3000/api/auth/${action}`,{ method: 'POST',headers: { origin: process.env.SITE_URL,'content-type': 'application/json' },body: JSON.stringify({ email,password }) })
  const context = action => ({ params: Promise.resolve({ action }) })
  const mailCount = globalThis.testMailbox.length
  delete process.env.EMAIL_VERIFICATION_REQUIRED
  globalThis.testMailConfigured = false
  try {
    const response = await auth.POST(request('signup'),context('signup'))
    assert.equal(response.status,200)
    assert.ok(response.headers.get('set-cookie'))
    const user = (await response.json()).data.user
    assert.equal(user.email_verified_at,null)
    const token = await createSession(user.id)
    assert.equal((await userForSession(token)).id,user.id)
    assert.equal((await login(email,password)).id,user.id)
    assert.equal(globalThis.testMailbox.length,mailCount)
    assert.equal((await auth.POST(request('resend-verification'),context('resend-verification'))).status,200)
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    assert.equal(await login(email,password),null)
    assert.equal(await userForSession(token),null)
    await assert.rejects(createSession(user.id))
  } finally {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    globalThis.testMailConfigured = true
  }
})
