import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPublicAppUrl } from '@/lib/site-url'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const requestedPath = request.nextUrl.searchParams.get('next')
  const nextPath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(getPublicAppUrl(nextPath, request.nextUrl))
    }
  }

  return NextResponse.redirect(getPublicAppUrl('/giris?hata=dogrulama', request.nextUrl))
}
