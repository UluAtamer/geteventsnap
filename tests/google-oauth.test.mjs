import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const directory = mkdtempSync(join(tmpdir(),'eventsnap-oauth-'))
const compile = (source,name) => {
  writeFileSync(join(directory,name),ts.transpileModule(source,{ compilerOptions: { target: ts.ScriptTarget.ES2022,module: ts.ModuleKind.ES2022 } }).outputText)
  return import(pathToFileURL(join(directory,name)).href)
}
const config = await compile(readFileSync('src/lib/google-oauth-config.ts','utf8').replace("import 'server-only'",''),'config.mjs')
after(() => rmSync(directory,{ recursive: true,force: true }))
Object.assign(process.env,{ NODE_ENV: 'production',SITE_URL: 'https://www.geteventsnap.com',GOOGLE_CLIENT_ID: ' test-client.apps.googleusercontent.com ',GOOGLE_CLIENT_SECRET: 'private-test-secret' })
delete process.env.GOOGLE_REDIRECT_URI

test('Google redirect uses the configured public HTTPS origin behind an internal proxy', () => {
  assert.equal(config.getGoogleDriveOAuthConfig('http://container:3000').redirectUri,'https://www.geteventsnap.com/api/google/drive/callback')
  assert.equal(config.getGoogleDriveOAuthConfig('http://container:3000').clientId,'test-client.apps.googleusercontent.com')
  process.env.GOOGLE_REDIRECT_URI = 'https://geteventsnap.com/api/google/drive/callback'
  assert.throws(() => config.getGoogleDriveOAuthConfig('http://container:3000'))
  process.env.GOOGLE_REDIRECT_URI = 'https://www.geteventsnap.com/api/google/drive/callback'
  assert.equal(config.getGoogleDriveSetupInfo('http://container:3000').authorizedJavaScriptOrigin,'https://www.geteventsnap.com')
  assert.ok(!JSON.stringify(config.getGoogleDriveSetupInfo('http://container:3000')).includes('private-test-secret'))
})

test('OAuth diagnostics reject visitors and ordinary users and never return secrets to administrators', async () => {
  const serverUrl = pathToFileURL(resolve('node_modules/next/server.js')).href
  await compile(readFileSync('src/lib/admin-access.ts','utf8'),'access.mjs')
  writeFileSync(join(directory,'session.mjs'),`export async function createClient() { return { auth: { async getUser() { return { data: { user: globalThis.diagnosticUser } } } } } }`)
  const source = readFileSync('src/app/api/google/drive/config/route.ts','utf8')
    .replace("from 'next/server'",`from '${serverUrl}'`)
    .replace("from '@/lib/db/server'","from './session.mjs'")
    .replace("from '@/lib/admin-access'","from './access.mjs'")
    .replace("from '@/lib/google-oauth-config'","from './config.mjs'")
  const { GET } = await compile(source,'route.mjs')
  const request = new Request('https://www.geteventsnap.com/api/google/drive/config')
  globalThis.diagnosticUser = null
  assert.equal((await GET(request)).status,401)
  globalThis.diagnosticUser = { id: 'member',is_admin: false }
  assert.equal((await GET(request)).status,403)
  globalThis.diagnosticUser = { id: 'admin',is_admin: true,email: 'private-admin@example.test' }
  const response = await GET(request)
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  const body = await response.json()
  assert.deepEqual(Object.keys(body).sort(),['authorizedJavaScriptOrigin','clientId','redirectUri'])
  assert.ok(!JSON.stringify(body).includes(process.env.GOOGLE_CLIENT_SECRET))
  assert.ok(!JSON.stringify(body).includes('private-admin@example.test'))
  delete globalThis.diagnosticUser
})
