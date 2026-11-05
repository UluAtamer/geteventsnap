import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const settings = {
  DATABASE_URL: 'postgresql://app:test-only-password@internal-db:5432/eventsnap',
  SITE_URL: 'https://example.invalid',
  GOOGLE_CLIENT_ID: 'test-only-client-id',
  GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
  EMAIL_VERIFICATION_REQUIRED: 'true',
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_USER: 'test-smtp-user',
  SMTP_PASSWORD: 'test-smtp-password',
  SMTP_FROM: 'noreply@example.invalid',
}
const validate = overrides => spawnSync(process.execPath, ['scripts/validate-env.mjs'], {
  env: { ...settings, ...overrides }, encoding: 'utf8',
})

test('Dokploy runtime settings validate without printing credentials', () => {
  const valid = validate({})
  assert.equal(valid.status, 0)
  assert.equal(valid.stdout + valid.stderr, '')
  for (const invalid of [
    { DATABASE_URL: '' },
    { EMAIL_VERIFICATION_REQUIRED: 'yes' },
    { SEED_USER_ENABLED: 'true' },
    { SEED_USER_IS_ADMIN: 'yes' },
    { SEED_USER_ENABLED: 'true', SEED_USER_EMAIL: 'seed@example.test', SEED_USER_PASSWORD: 'short' },
    { SITE_URL: 'http://example.invalid' },
    { GOOGLE_REDIRECT_URI: 'https://another.example.invalid/callback' },
    { NEXT_PUBLIC_DATABASE_URL: settings.DATABASE_URL },
  ]) {
    const result = validate(invalid)
    assert.equal(result.status, 1)
    const output = result.stdout + result.stderr
    for (const [name,value] of Object.entries(settings)) {
      if (name !== 'EMAIL_VERIFICATION_REQUIRED') assert.ok(!output.includes(value))
    }
  }
})


test('missing SMTP reports disabled mail without stopping the application', () => {
  const result = validate({ SMTP_HOST: '', SMTP_PASSWORD: '' })
  assert.equal(result.status, 0)
  assert.match(result.stderr, /SMTP ayarları eksik/)
  for (const secret of Object.values(settings)) assert.ok(!result.stderr.includes(secret))
})


test('disabled email verification starts without SMTP warnings', () => {
  const result = validate({ EMAIL_VERIFICATION_REQUIRED: 'false', SMTP_HOST: '', SMTP_PASSWORD: '' })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
})
