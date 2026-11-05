import { NextResponse } from 'next/server'
import { database } from '@/lib/db/core'
import { isSameOriginRequest } from '@/lib/request-origin'
import { DatingError, DATING_COOKIE, getGuestToken, getGuestProfile, getDatingEvent, isDatingEventActive, requireDatingProfile, participantProfile, datingFeed, enforceDatingRateLimit, createDatingProfile, readDatingJson, uuidPattern, interact, protectParticipant } from '@/lib/dating-server'

export const runtime = 'nodejs'
type Context = { params: Promise<{ slug: string; action: string }> }
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' }
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }) }
function withCookie(response: NextResponse, slug: string, token: string) {
  response.cookies.set(DATING_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: `/api/events/${encodeURIComponent(slug)}/dating`, maxAge: 86400 })
  return response
}
function failure(error: unknown) {
  if (error instanceof DatingError) return json({ error: error.message }, error.status)
  console.error('[Tanışma] İşlem tamamlanamadı.')
  return json({ error: 'Tanışma işlemi tamamlanamadı. Lütfen tekrar deneyin.' }, 500)
}
export async function GET(request: Request, { params }: Context) {
  try {
    const { slug, action } = await params
    if (!['session','feed'].includes(action)) return json({},404)
    const event = await getDatingEvent(slug)
    await enforceDatingRateLimit(request,event)
    if (action === 'session') {
      if (!isDatingEventActive(event)) return json({ active: false, enabled: event.dating_enabled })
      const token = getGuestToken(request)
      const profile = token ? await getGuestProfile(event.id,token) : null
      const response = json({ active: true, profile: profile ? participantProfile(profile,slug) : null })
      return profile && token ? withCookie(response,slug,token) : response
    }
    const own = await requireDatingProfile(request,event)
    return json(await datingFeed(event,own,slug))
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, { params }: Context) {
  try {
    if (!isSameOriginRequest(request)) return json({ error: 'Geçersiz kaynak.' },403)
    const { slug, action } = await params
    if (!['profile','interactions','safety'].includes(action)) return json({},404)
    const event = await getDatingEvent(slug)
    await enforceDatingRateLimit(request,event,action === 'profile')
    if (action === 'profile') {
      const token = getGuestToken(request)
      if (!token) return json({ error: 'Misafir oturumu gerekli.' },401)
      const profile = await createDatingProfile(request,event,token)
      return withCookie(json({ profile: participantProfile(profile,slug) },201),slug,token)
    }
    const own = await requireDatingProfile(request,event)
    const body = await readDatingJson(request)
    if (typeof body.profileId !== 'string' || !uuidPattern.test(body.profileId)) return json({ error: 'Profil geçersiz.' },400)
    if (action === 'interactions') {
      if (!['like','pass'].includes(body.action)) return json({ error: 'İşlem geçersiz.' },400)
      return json(await interact(event,own,body.profileId,body.action,slug))
    }
    await protectParticipant(event,own,body.profileId,String(body.action || ''),String(body.reason || '').trim())
    return json({ success: true })
  } catch (error) { return failure(error) }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    if (!isSameOriginRequest(request)) return json({ error: 'Geçersiz kaynak.' },403)
    const { slug, action } = await params
    if (!['interactions','safety'].includes(action)) return json({},404)
    const event = await getDatingEvent(slug)
    const own = await requireDatingProfile(request,event,action !== 'safety')
    await enforceDatingRateLimit(request,event)
    if (action === 'safety') {
      await database().prepare('DELETE FROM guest_profiles WHERE id=? AND event_id=?').run(own.id,event.id)
      const response = json({ success: true })
      response.cookies.set(DATING_COOKIE,'',{ path: `/api/events/${encodeURIComponent(slug)}/dating`, maxAge: 0, httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' })
      return response
    }
    const body = await readDatingJson(request)
    if (typeof body.profileId !== 'string' || !uuidPattern.test(body.profileId)) return json({ error: 'Profil geçersiz.' },400)
    return json(await interact(event,own,body.profileId,'remove',slug))
  } catch (error) { return failure(error) }
}
