import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'

const path = '.env.local'
if (existsSync(path)) {
  console.log('.env.local mevcut; ayarlar korunuyor.')
  process.exit(0)
}
const password = randomBytes(24).toString('hex')
writeFileSync(path, `# Local development only. Never commit this file.
LOCAL_POSTGRES_PASSWORD=${password}
DATABASE_URL=postgresql://eventsnap:${password}@127.0.0.1:54329/eventsnap
DATABASE_POOL_MAX=10
SITE_URL=http://localhost:3002
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3002/api/google/drive/callback
DRIVE_TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
ADMIN_USER_ID=
GUEST_MAX_PHOTO_BYTES=26214400
GUEST_MAX_VIDEO_BYTES=524288000
`, { mode: 0o600, flag: 'wx' })
chmodSync(path, 0o600)
console.log('Yerel ayarlar .env.local dosyasında oluşturuldu. Google Drive için kendi OAuth bilgilerinizi ekleyin.')
