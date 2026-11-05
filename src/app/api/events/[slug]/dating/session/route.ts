import { NextResponse } from 'next/server'
import {
  getDatingEvent,
  getGuestProfile,
  getGuestToken,
  getSignedPhotoUrl,
  isDatingEventActive,
  publicProfile,
} from '@/lib/dating-server'

type RouteContext = { params: Promise<{ slug: string }> }

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })

    const active = isDatingEventActive(event)
    if (!active) {
      return NextResponse.json({
        active: false,
        enabled: event.dating_enabled,
        reason: event.dating_enabled ? 'event_day_only' : 'disabled',
      })
    }

    const token = getGuestToken(request)
    const profile = token ? await getGuestProfile(event.id, token) : null
    const ownProfile = profile
      ? publicProfile(profile, await getSignedPhotoUrl(profile.photo_path))
      : null
    return NextResponse.json({ active: true, profile: ownProfile })
  } catch (error) {
    console.error('Tanışma oturumu okunamadı:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tanışma bilgileri alınamadı.' },
      { status: 500 },
    )
  }
}
