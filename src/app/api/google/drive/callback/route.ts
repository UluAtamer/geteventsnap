import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  createGoogleDriveFolder,
  decryptGoogleRefreshToken,
  deleteGoogleDriveFolder,
  encryptGoogleRefreshToken,
  exchangeGoogleAuthorizationCode,
  getGoogleDriveOAuthConfig,
  hasGoogleDriveServerConfig,
} from '@/lib/google-drive'
import { createAdminClient } from '@/lib/db/admin'
import { createClient } from '@/lib/db/server'
import { getPublicAppUrl } from '@/lib/site-url'

export const runtime = 'nodejs'

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dashboardRedirect(requestUrl: URL, code: string, clearState = true) {
  const destination = getPublicAppUrl('/dashboard', requestUrl)
  destination.searchParams.set('drive', code)
  const response = NextResponse.redirect(destination)
  if (clearState) {
    response.cookies.set('drive_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/google/drive/callback',
      maxAge: 0,
    })
  }
  return response
}

async function removeTemporaryFolder(accessToken: string, folderId: string) {
  try {
    await deleteGoogleDriveFolder(accessToken, folderId)
  } catch (error) {
    console.error('Bağlantı tamamlanamadığı için geçici Drive klasörü temizlenemedi:', error)
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const state = requestUrl.searchParams.get('state')
  const storedState = request.headers.get('cookie')
    ?.split('; ')
    .find((cookie) => cookie.startsWith('drive_oauth_state='))
    ?.slice('drive_oauth_state='.length)
  let decodedStoredState = ''
  try {
    decodedStoredState = storedState ? decodeURIComponent(storedState) : ''
  } catch {
    return dashboardRedirect(requestUrl, 'invalid_state')
  }

  if (!state || !decodedStoredState) {
    return dashboardRedirect(requestUrl, 'invalid_state')
  }

  const stateBytes = Buffer.from(state)
  const storedStateBytes = Buffer.from(decodedStoredState)
  if (stateBytes.length !== storedStateBytes.length || !timingSafeEqual(stateBytes, storedStateBytes)) {
    return dashboardRedirect(requestUrl, 'invalid_state')
  }

  const eventId = state.split('.')[0]
  if (!eventIdPattern.test(eventId)) {
    return dashboardRedirect(requestUrl, 'invalid_state')
  }

  if (requestUrl.searchParams.has('error')) {
    const googleError = requestUrl.searchParams.get('error')
    return dashboardRedirect(requestUrl, googleError === 'access_denied' ? 'access_denied' : 'cancelled')
  }
  const code = requestUrl.searchParams.get('code')
  if (!code) {
    return dashboardRedirect(requestUrl, 'oauth_failed')
  }
  if (!hasGoogleDriveServerConfig()) {
    return dashboardRedirect(requestUrl, 'setup_required')
  }

  const database = await createClient()
  const { data: { user }, error: userError } = await database.auth.getUser()
  if (userError || !user) {
    return dashboardRedirect(requestUrl, 'session_expired')
  }

  const { data: event, error: eventError } = await database
    .from('events')
    .select('id, title')
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .single()

  if (eventError || !event) {
    if (eventError) {
      console.error('Google Drive dönüşünde etkinlik doğrulanamadı:', eventError)
    }
    return dashboardRedirect(requestUrl, 'event_not_found')
  }

  let accessToken = ''
  let createdFolderId: string | null = null

  try {
    const oauthConfig = getGoogleDriveOAuthConfig(requestUrl.origin)
    const admin = createAdminClient()
    const { data: oldConnection, error: oldConnectionError } = await admin
      .from('event_drive_connections')
      .select('encrypted_refresh_token, drive_folder_id, drive_folder_url')
      .eq('event_id', event.id)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (oldConnectionError) {
      console.error('Mevcut Google Drive bağlantısı okunamadı:', oldConnectionError)
      return dashboardRedirect(requestUrl, 'connection_check_failed')
    }

    const tokens = await exchangeGoogleAuthorizationCode(code, oauthConfig)
    accessToken = tokens.accessToken
    let refreshToken = tokens.refreshToken || ''
    if (!refreshToken && oldConnection?.encrypted_refresh_token) {
      try {
        refreshToken = decryptGoogleRefreshToken(oldConnection.encrypted_refresh_token)
      } catch {
        return dashboardRedirect(requestUrl, 'refresh_token_missing')
      }
    }
    if (!refreshToken) {
      return dashboardRedirect(requestUrl, 'refresh_token_missing')
    }

    let folder = oldConnection?.drive_folder_id && oldConnection.drive_folder_url
      ? { id: oldConnection.drive_folder_id, url: oldConnection.drive_folder_url }
      : null

    if (!folder) {
      folder = await createGoogleDriveFolder(accessToken, event.title)
      createdFolderId = folder.id
    }

    const { error: saveError } = await admin
      .from('event_drive_connections')
      .upsert({
        event_id: event.id,
        owner_id: user.id,
        encrypted_refresh_token: encryptGoogleRefreshToken(refreshToken),
        drive_folder_id: folder.id,
        drive_folder_url: folder.url,
        connection_status: 'connected',
        connected_at: new Date().toISOString(),
        last_error_at: null,
      }, { onConflict: 'event_id' })

    if (saveError) {
      console.error('Şifrelenmiş Google Drive bağlantısı kaydedilemedi:', saveError)
      if (createdFolderId) {
        await removeTemporaryFolder(accessToken, createdFolderId)
      }
      return dashboardRedirect(requestUrl, 'save_failed')
    }

    return dashboardRedirect(requestUrl, 'connected')
  } catch (error) {
    console.error('Google Drive OAuth bağlantısı tamamlanamadı:', error)
    if (accessToken && createdFolderId) {
      await removeTemporaryFolder(accessToken, createdFolderId)
    }
    return dashboardRedirect(requestUrl, 'oauth_failed')
  }
}
