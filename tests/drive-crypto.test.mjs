import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const directory = mkdtempSync(join(tmpdir(), 'eventsnap-crypto-'))
const source = readFileSync('src/lib/drive-crypto.ts', 'utf8').replace("import 'server-only'", '')
const path = join(directory, 'crypto.mjs')
writeFileSync(path, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
const { deriveDriveKey, encryptGoogleRefreshToken, decryptGoogleRefreshToken } = await import(pathToFileURL(path).href)
const previous = process.env.GOOGLE_CLIENT_SECRET
process.env.GOOGLE_CLIENT_SECRET = 'test-only-google-client-secret'
after(() => {
  if (previous === undefined) delete process.env.GOOGLE_CLIENT_SECRET
  else process.env.GOOGLE_CLIENT_SECRET = previous
  rmSync(directory, { recursive: true, force: true })
})

test('Drive tokens stay encrypted without a separate environment encryption key', () => {
  const token = 'private-refresh-token-1234'
  const first = encryptGoogleRefreshToken(token)
  const second = encryptGoogleRefreshToken(token)
  assert.ok(first.startsWith('v2.'))
  assert.ok(!first.includes(token))
  assert.notEqual(first, second)
  assert.equal(decryptGoogleRefreshToken(first), token)
  assert.equal(decryptGoogleRefreshToken(second), token)
  assert.equal(deriveDriveKey('tokens').length, 32)
  assert.notDeepEqual(deriveDriveKey('tokens'), deriveDriveKey('guest-uploads'))
})

test('tampering, legacy tokens and a changed Google secret cannot decrypt user credentials', () => {
  const encrypted = encryptGoogleRefreshToken('private-refresh-token-5678')
  const parts = encrypted.split('.')
  const ciphertext = Buffer.from(parts[3], 'base64url')
  ciphertext[0] ^= 1
  parts[3] = ciphertext.toString('base64url')
  assert.throws(() => decryptGoogleRefreshToken(parts.join('.')))
  assert.throws(() => decryptGoogleRefreshToken('old-iv.old-tag.old-ciphertext'))
  const original = process.env.GOOGLE_CLIENT_SECRET
  try {
    process.env.GOOGLE_CLIENT_SECRET = 'another-test-only-secret'
    assert.throws(() => decryptGoogleRefreshToken(encrypted))
    delete process.env.GOOGLE_CLIENT_SECRET
    assert.throws(() => encryptGoogleRefreshToken('private-token'))
  } finally { process.env.GOOGLE_CLIENT_SECRET = original }
})
