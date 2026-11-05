import 'server-only'

import type { GoogleDriveOAuthConfig } from '@/lib/google-oauth-config'
export { getGoogleDriveOAuthConfig, hasGoogleDriveServerConfig } from '@/lib/google-oauth-config'

export { encryptGoogleRefreshToken, decryptGoogleRefreshToken } from '@/lib/drive-crypto'

type JsonObject = Record<string, unknown>

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
