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
writeFileSync(join(directory, 'ui-preview.mjs'), ts.transpileModule(readFileSync('src/lib/ui-preview.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
for (const name of ['core', 'auth']) {
  const source = readFileSync(resolve(`src/lib/db/${name}.ts`), 'utf8')
    .replace("from './core'", "from './core.mjs'")
    .replace("from '../ui-preview'", "from './ui-preview.mjs'")
    .replace("from 'pg'", "from './pg-test-adapter.mjs'")
  writeFileSync(join(directory, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
}
const { engine } = await import(pathToFileURL(join(directory, 'pg-test-adapter.mjs')).href)
await engine.exec('CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)')
try {
  await engine.exec(readFileSync('db/migrations/001_initial.sql', 'utf8'))
  await engine.exec(readFileSync('db/migrations/002_admin_role.sql', 'utf8'))
} catch (error) { throw new Error(error.message) }
const { database, Query, rpc, consumeRateLimit } = await import(pathToFileURL(join(directory, 'core.mjs')).href)
const { register, login, createSession, userForSession, revokeSession, changePassword, userAdmin } = await import(pathToFileURL(join(directory, 'auth.mjs')).href)
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
    .replace("from '@/lib/db/auth'", "from './auth.mjs'")
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
  const response = await auth.POST(authRequest('signup', { email: 'route@example.test', password }), context('signup'))
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
    .replace("import GuestUploadForm from '@/components/events/GuestUploadForm'", "function GuestUploadForm(props) { return React.createElement('div', { 'data-client-props': JSON.stringify(props) }) }")
    .replace("import { getGuestUploadLimits } from '@/lib/guest-upload'", "function getGuestUploadLimits() { return { photoBytes: 10, videoBytes: 20 } }")
    .replace("from '@/lib/event-upload-window'", "from './window.mjs'")
    .replace("from '@/lib/db/core'", "from './core.mjs'")
    .replace("from '@/lib/ui-preview'", "from './ui-preview.mjs'")
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
  for (const version of ['001_initial.sql', '002_admin_role.sql']) {
    writeFileSync(join(directory, 'db', 'migrations', version), readFileSync(`db/migrations/${version}`))
  }
  const source = readFileSync('scripts/migrate.mjs', 'utf8').replace("from 'pg'", "from '../pg-test-adapter.mjs'")
  writeFileSync(join(directory, 'scripts', 'migrate.mjs'), source)
  const migrationUrl = pathToFileURL(join(directory, 'scripts', 'migrate.mjs')).href
  await import(migrationUrl + '?first')
  await import(migrationUrl + '?second')
  assert.equal(process.exitCode || 0, 0)
  const versions = await database().prepare('SELECT version FROM schema_migrations ORDER BY version').all()
  assert.deepEqual(versions.map(row => row.version), ['001_initial.sql', '002_admin_role.sql'])
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
  assert.equal((await response.json()).data.user.is_admin, false)
  assert.equal((await login('role-injection@example.test', password)).is_admin, false)
})
