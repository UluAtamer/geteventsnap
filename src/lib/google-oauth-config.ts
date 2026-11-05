import 'server-only'

export type GoogleDriveOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string }

export function hasGoogleDriveServerConfig() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim())
}

export function getGoogleDriveOAuthConfig(origin: string): GoogleDriveOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret?.trim()) throw new Error('Google OAuth bilgileri yapılandırılmamış.')
  const site = process.env.SITE_URL?.trim()
  if (!site && process.env.NODE_ENV === 'production') throw new Error('SITE_URL yapılandırılmamış.')
  let base: URL
  try { base = new URL(site || origin) } catch { throw new Error('SITE_URL geçersiz.') }
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !['https:','http:'].includes(base.protocol) || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) throw new Error('SITE_URL geçersiz.')
  const expected = new URL('/api/google/drive/callback',base).toString()
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (configured && configured !== expected) throw new Error('GOOGLE_REDIRECT_URI, SITE_URL üzerindeki /api/google/drive/callback adresiyle aynı olmalı.')
  return { clientId,clientSecret,redirectUri: expected }
}

// Explicit projection: never serialize clientSecret or user credentials.
export function getGoogleDriveSetupInfo(origin: string) {
  const { clientId,redirectUri } = getGoogleDriveOAuthConfig(origin)
  return { clientId,redirectUri,authorizedJavaScriptOrigin: new URL(redirectUri).origin }
}
