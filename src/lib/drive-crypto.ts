import 'server-only'

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export function deriveDriveKey(purpose: 'tokens' | 'guest-uploads') {
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!secret?.trim()) throw new Error('Google OAuth bilgileri yapılandırılmamış.')
  return Buffer.from(hkdfSync('sha256', secret, 'eventsnap/google-drive/v2', purpose, 32))
}

export function encryptGoogleRefreshToken(refreshToken: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveDriveKey('tokens'), iv)
  const encrypted = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()])
  return ['v2', ...[iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url'))].join('.')
}

export function decryptGoogleRefreshToken(encryptedToken: string) {
  const [version, encodedIv, encodedTag, encodedValue, ...extra] = encryptedToken.split('.')
  if (version !== 'v2' || !encodedIv || !encodedTag || !encodedValue || extra.length) {
    throw new Error('Google Drive bağlantısını yeniden kurmak gerekiyor.')
  }
  const iv = Buffer.from(encodedIv, 'base64url')
  const tag = Buffer.from(encodedTag, 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Drive erişim bilgisi geçersiz.')
  const decipher = createDecipheriv('aes-256-gcm', deriveDriveKey('tokens'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
