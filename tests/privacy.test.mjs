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
try { await engine.exec(readFileSync('db/migrations/001_initial.sql', 'utf8')) } catch (error) { throw new Error(error.message) }
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
  writeFileSync(join(directory, 'db', 'migrations', '001_initial.sql'), readFileSync('db/migrations/001_initial.sql'))
  const source = readFileSync('scripts/migrate.mjs', 'utf8').replace("from 'pg'", "from '../pg-test-adapter.mjs'")
  writeFileSync(join(directory, 'scripts', 'migrate.mjs'), source)
  const migrationUrl = pathToFileURL(join(directory, 'scripts', 'migrate.mjs')).href
  await import(migrationUrl + '?first')
  await import(migrationUrl + '?second')
  assert.equal(process.exitCode || 0, 0)
  const versions = await database().prepare('SELECT version FROM schema_migrations').all()
  assert.deepEqual(versions.map(row => row.version), ['001_initial.sql'])
})
