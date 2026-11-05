import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createDatingAdminClient } from '@/lib/dating-server'

function currentIstanbulDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${date.year}-${date.month}-${date.day}`
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization') ?? ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!secret || !supplied) return false
  const expectedBytes = Buffer.from(secret)
  const suppliedBytes = Buffer.from(supplied)
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Zamanlanmış temizleme anahtarı yapılandırılmamış.' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 401 })
  }

  const admin = createDatingAdminClient()
  const { data: expiredEvents, error: eventsError } = await admin
    .from('events')
    .select('id')
    .lt('event_date', currentIstanbulDate())
  if (eventsError) {
    console.error('Tanışma temizliği için etkinlikler alınamadı:', eventsError)
    return NextResponse.json({ error: 'Temizleme başlatılamadı.' }, { status: 500 })
  }

  let removedProfiles = 0
  for (const event of expiredEvents ?? []) {
    const { data: profiles, error: profilesError } = await admin
      .from('guest_profiles')
      .select('id, photo_path')
      .eq('event_id', event.id)
    if (profilesError) {
      console.error('Süresi dolan Tanışma profilleri alınamadı:', profilesError)
      return NextResponse.json({ error: 'Profil temizliği tamamlanamadı.' }, { status: 500 })
    }

    const photoPaths = (profiles ?? []).map((profile) => profile.photo_path)
    for (let index = 0; index < photoPaths.length; index += 100) {
      const { error: photoError } = await admin.storage
        .from('dating-photos')
        .remove(photoPaths.slice(index, index + 100))
      if (photoError) {
        console.error('Süresi dolan Tanışma fotoğrafları silinemedi:', photoError)
        return NextResponse.json({ error: 'Fotoğraf temizliği tamamlanamadı.' }, { status: 500 })
      }
    }

    const { error: deleteError } = await admin.from('guest_profiles').delete().eq('event_id', event.id)
    if (deleteError) {
      console.error('Süresi dolan Tanışma verileri silinemedi:', deleteError)
      return NextResponse.json({ error: 'Profil verileri temizlenemedi.' }, { status: 500 })
    }
    const { error: closeError } = await admin.from('events')
      .update({ dating_enabled: false })
      .eq('id', event.id)
    if (closeError) {
      console.error('Süresi dolan etkinliğin Tanışma ayarı kapatılamadı:', closeError)
      return NextResponse.json({ error: 'Tanışma ayarı otomatik kapatılamadı.' }, { status: 500 })
    }
    removedProfiles += profiles?.length ?? 0
  }

  return NextResponse.json({ success: true, removedProfiles })
}
