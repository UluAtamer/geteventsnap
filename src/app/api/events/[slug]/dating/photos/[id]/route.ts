import { NextResponse } from 'next/server'
import { database } from '@/lib/db/core'
import { SESSION_COOKIE, userForSession } from '@/lib/db/auth'
import { getDatingEvent, requireDatingProfile, areBlocked, cookieValue, uuidPattern } from '@/lib/dating-server'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' }
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug,id } = await params
    if (!uuidPattern.test(id)) return new NextResponse(null,{ status: 404, headers })
    const event = await getDatingEvent(slug)
    const user = await userForSession(cookieValue(request,SESSION_COOKIE))
    if (!user || user.id !== event.owner_id) {
      const own = await requireDatingProfile(request,event)
      if (await areBlocked(event.id,own.id,id)) return new NextResponse(null,{ status: 404, headers })
    }
    const photo = await database().prepare('SELECT photo_content,photo_type FROM guest_profiles WHERE id=? AND event_id=?').get(id,event.id)
    if (!photo) return new NextResponse(null,{ status: 404, headers })
    return new NextResponse(new Uint8Array(photo.photo_content), { headers: { ...headers,'Content-Type': photo.photo_type } })
  } catch { return new NextResponse(null,{ status: 404, headers }) }
}
