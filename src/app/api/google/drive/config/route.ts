import { NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { isAdminUser } from '@/lib/admin-access'
import { getGoogleDriveSetupInfo } from '@/lib/google-oauth-config'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' }
export async function GET(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Oturum açın.' },{ status: 401,headers })
  if (!isAdminUser(user)) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' },{ status: 403,headers })
  try { return NextResponse.json(getGoogleDriveSetupInfo(new URL(request.url).origin),{ headers }) }
  catch { return NextResponse.json({ error: 'Google OAuth ayarları eksik veya tutarsız. SITE_URL ile GOOGLE_REDIRECT_URI değerlerini eşleştirin.' },{ status: 422,headers }) }
}
