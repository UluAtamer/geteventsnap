import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGoogleDriveOAuthConfig, hasGoogleDriveServerConfig } from '@/lib/google-drive'
import { createClient } from '@/lib/supabase/server'
import { getPublicAppUrl } from '@/lib/site-url'

export const runtime = 'nodejs'

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dashboardRedirect(requestUrl: URL, code: string) {
  const destination = getPublicAppUrl('/dashboard', requestUrl)
  destination.searchParams.set('drive', code)
  return NextResponse.redirect(destination)
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.redirect(getPublicAppUrl('/giris', requestUrl))
  }

  const eventId = requestUrl.searchParams.get('eventId') ?? ''
  if (!eventIdPattern.test(eventId)) {
    return dashboardRedirect(requestUrl, 'event_not_found')
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, title')
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .single()

  if (eventError || !event) {
    if (eventError?.code !== 'PGRST116') {
      console.error('Google Drive bağlantısı için etkinlik doğrulanamadı:', eventError)
    }
    return dashboardRedirect(requestUrl, 'event_not_found')
  }

  if (!hasGoogleDriveServerConfig()) {
    return dashboardRedirect(requestUrl, 'setup_required')
  }

  let oauthConfig
  let admin
  try {
    oauthConfig = getGoogleDriveOAuthConfig(requestUrl.origin)
    admin = createAdminClient()
  } catch (error) {
    console.error('Google Drive sunucu ayarları geçersiz:', error)
    return dashboardRedirect(requestUrl, 'setup_required')
  }

  const { data: existingConnection, error: connectionError } = await admin
    .from('event_drive_connections')
    .select('connection_status')
    .eq('event_id', event.id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (connectionError) {
    console.error('Google Drive bağlantı kaydı okunamadı:', connectionError)
    return dashboardRedirect(requestUrl, connectionError.code === '42P01' ? 'migration_required' : 'connection_check_failed')
  }
  if (existingConnection?.connection_status === 'connected') {
    return dashboardRedirect(requestUrl, 'already_connected')
  }

  const state = `${event.id}.${randomBytes(32).toString('base64url')}`
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizationUrl.searchParams.set('client_id', oauthConfig.clientId)
  authorizationUrl.searchParams.set('redirect_uri', oauthConfig.redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file')
  authorizationUrl.searchParams.set('access_type', 'offline')
  authorizationUrl.searchParams.set('prompt', 'consent')
  authorizationUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizationUrl)
  response.cookies.set('drive_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/google/drive/callback',
    ...(process.env.NODE_ENV === 'production' ? { domain: '.geteventsnap.com' } : {}),
    maxAge: 10 * 60,
  })
  return response
}
