import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const directory = mkdtempSync(join(tmpdir(), 'eventsnap-mail-'))
const source = readFileSync('src/lib/mail.ts', 'utf8').replace("import 'server-only'", '').replace("from 'nodemailer'", "from './transport.mjs'")
writeFileSync(join(directory, 'transport.mjs'), `export default { createTransport(options) { globalThis.smtpOptions = options; return { async sendMail(message) { globalThis.smtpMessage = message; return { accepted: [message.to.address] } }, close() { globalThis.smtpClosed = true } } } }`)
writeFileSync(join(directory, 'mail.mjs'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText)
const { isMailConfigured, sendVerificationEmail, mailConfigurationIssues } = await import(pathToFileURL(join(directory, 'mail.mjs')).href)
Object.assign(process.env, { SITE_URL: 'https://private.example.test', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-password', SMTP_FROM: 'noreply@example.test' })
after(() => { rmSync(directory, { recursive: true, force: true }) })

test('mail uses TLS and sends an application-origin confirmation link without a query token', async () => {
  assert.equal(isMailConfigured(), true)
  const token = 'a'.repeat(64)
  await sendVerificationEmail('recipient@example.test', token)
  assert.equal(globalThis.smtpOptions.secure, true)
  assert.equal(globalThis.smtpOptions.tls.rejectUnauthorized, true)
  assert.equal(globalThis.smtpOptions.logger, false)
  assert.equal(globalThis.smtpOptions.debug, false)
  assert.equal(globalThis.smtpMessage.to.address, 'recipient@example.test')
  const link = globalThis.smtpMessage.text.match(/https:\/\/[^\s]+/)[0]
  const url = new URL(link)
  assert.equal(url.origin, 'https://private.example.test')
  assert.equal(url.pathname, '/eposta-onay')
  assert.equal(url.search, '')
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), token)
  assert.equal(globalThis.smtpClosed, true)
  process.env.SMTP_PORT = '587'; process.env.SMTP_SECURE = 'false'
  await sendVerificationEmail('recipient@example.test', token)
  assert.equal(globalThis.smtpOptions.secure, false)
  assert.equal(globalThis.smtpOptions.requireTLS, true)
  delete process.env.SMTP_PASSWORD
  assert.deepEqual(mailConfigurationIssues(), ['SMTP_PASSWORD'])
  const logs = []
  const originalWarn = console.warn
  console.warn = message => logs.push(message)
  try { assert.equal(isMailConfigured(), false) } finally { console.warn = originalWarn }
  assert.match(logs.join(''), /SMTP_PASSWORD/)
  assert.ok(!logs.join('').includes('test-user'))
  assert.ok(!logs.join('').includes('recipient@example.test'))
  assert.ok(!logs.join('').includes('smtp.example.test'))
})
