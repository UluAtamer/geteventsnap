import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getPublicAppUrl } from '@/lib/site-url'

type JsonObject = Record<string, unknown>

export type GoogleDriveOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

function encryptionKey() {
  const encodedKey = process.env.DRIVE_TOKEN_ENCRYPTION_KEY
  if (!encodedKey) {
    throw new Error('Drive token şifreleme anahtarı yapılandırılmamış.')
  }

  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) {
    throw new Error('Drive token şifreleme anahtarı geçersiz; 32 baytlık Base64 anahtar gerekli.')
  }

  return key
}

export function hasGoogleDriveServerConfig() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.DRIVE_TOKEN_ENCRYPTION_KEY &&
    Buffer.from(process.env.DRIVE_TOKEN_ENCRYPTION_KEY, 'base64').length === 32
  )
}

export function getGoogleDriveOAuthConfig(origin: string): GoogleDriveOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth bilgileri yapılandırılmamış.')
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
      getPublicAppUrl('/api/google/drive/callback', new URL(origin)).toString()
  const parsedRedirectUri = new URL(redirectUri)

  return { clientId, clientSecret, redirectUri: parsedRedirectUri.toString() }
}

export function encryptGoogleRefreshToken(refreshToken: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptGoogleRefreshToken(encryptedToken: string) {
  const [encodedIv, encodedTag, encodedValue, ...extra] = encryptedToken.split('.')
  if (!encodedIv || !encodedTag || !encodedValue || extra.length) {
    throw new Error('Saklanan Drive erişim bilgisi okunamıyor.')
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encodedIv, 'base64url'))
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

async function readJson(response: Response): Promise<JsonObject> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Google yanıtı okunamadı (HTTP ${response.status}).`)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Google yanıtı geçersiz (HTTP ${response.status}).`)
  }

  return payload as JsonObject
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  config: GoogleDriveOAuthConfig,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(`Google OAuth kodu reddedildi (HTTP ${response.status}).`)
  }

  const accessToken = payload.access_token
  const refreshToken = payload.refresh_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Google erişim anahtarı yanıtında bulunamadı.')
  }

  return {
    accessToken,
    ...(typeof refreshToken === 'string' && refreshToken ? { refreshToken } : {}),
  }
}

export async function createGoogleDriveFolder(accessToken: string, title: string) {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `${title} - Anılar`,
      mimeType: 'application/vnd.google-apps.folder',
    }),
    cache: 'no-store',
  })
  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(`Google Drive klasörü oluşturamadı (HTTP ${response.status}).`)
  }

  if (typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Google Drive klasör yanıtında klasör kimliği bulunamadı.')
  }

  return {
    id: payload.id,
    url: typeof payload.webViewLink === 'string' && payload.webViewLink
      ? payload.webViewLink
      : `https://drive.google.com/drive/folders/${payload.id}`,
  }
}

export async function deleteGoogleDriveFolder(accessToken: string, folderId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Google Drive geçici klasörü silemedi (HTTP ${response.status}).`)
  }
}
