import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  createDatingAdminClient,
  getSignedPhotoUrl,
  type GuestProfile,
} from '@/lib/dating-server'

async function getOwnerEvent(eventId: string) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { response: NextResponse.json({ error: 'Oturum açmanız gerekiyor.' }, { status: 401 }) }

  const { data: event, error } = await createDatingAdminClient()
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (error) {
    console.error('Bildirim sahibi doğrulanamadı:', error)
    return { response: NextResponse.json({ error: 'Etkinlik doğrulanamadı.' }, { status: 500 }) }
  }
  if (!event) return { response: NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 }) }
  return { event }
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('eventId') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Etkinlik seçimi geçerli değil.' }, { status: 400 })
  }
  const access = await getOwnerEvent(eventId)
  if (access.response) return access.response

  const { data: reports, error } = await createDatingAdminClient()
    .from('dating_reports')
    .select('id, reason, status, created_at, reported_profile_id')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    console.error('Tanışma bildirimleri alınamadı:', error)
    return NextResponse.json({ error: 'Bildirimler yüklenemedi.' }, { status: 500 })
  }

  const profileIds = [...new Set((reports ?? [])
    .map((report) => report.reported_profile_id)
    .filter((id): id is string => Boolean(id)))]
  const { data: profiles, error: profilesError } = profileIds.length
    ? await createDatingAdminClient().from('guest_profiles')
      .select('id, first_name, last_name, age, photo_path')
      .in('id', profileIds)
    : { data: [], error: null }
  if (profilesError) {
    console.error('Bildirilen Tanışma profilleri alınamadı:', profilesError)
    return NextResponse.json({ error: 'Profil bilgileri yüklenemedi.' }, { status: 500 })
  }

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
  const items = await Promise.all((reports ?? []).map(async (report) => {
    const profile = profilesById.get(report.reported_profile_id ?? '')
    return {
      id: report.id,
      reason: report.reason,
      createdAt: report.created_at,
      profile: profile
        ? {
            id: profile.id,
            name: `${profile.first_name} ${profile.last_name}`,
            age: profile.age,
            photoUrl: await getSignedPhotoUrl((profile as Pick<GuestProfile, 'photo_path'>).photo_path),
          }
        : null,
    }
  }))
  return NextResponse.json({ reports: items })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { eventId?: unknown; reportId?: unknown; action?: unknown }
    const eventId = String(body.eventId ?? '')
    const reportId = String(body.reportId ?? '')
    const action = String(body.action ?? '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId) ||
      !['dismiss', 'remove'].includes(action)) {
      return NextResponse.json({ error: 'İşlem bilgisi geçerli değil.' }, { status: 400 })
    }
    const access = await getOwnerEvent(eventId)
    if (access.response) return access.response
    const admin = createDatingAdminClient()
    const { data: report, error: reportError } = await admin.from('dating_reports')
      .select('id, reported_profile_id')
      .eq('id', reportId)
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .maybeSingle()
    if (reportError) {
      console.error('Tanışma bildirimi alınamadı:', reportError)
      return NextResponse.json({ error: 'Bildirim alınamadı.' }, { status: 500 })
    }
    if (!report) return NextResponse.json({ error: 'Bildirim bulunamadı veya zaten işlendi.' }, { status: 404 })

    if (action === 'remove' && report.reported_profile_id) {
      const { data: profile, error: profileError } = await admin.from('guest_profiles')
        .select('id, photo_path')
        .eq('id', report.reported_profile_id)
        .eq('event_id', eventId)
        .maybeSingle()
      if (profileError) {
        console.error('Bildirilen Tanışma profili alınamadı:', profileError)
        return NextResponse.json({ error: 'Profil kaldırılamadı.' }, { status: 500 })
      }
      if (profile) {
        const { error: deleteError } = await admin.from('guest_profiles')
          .delete()
          .eq('id', profile.id)
        if (deleteError) {
          console.error('Bildirilen Tanışma profili kaldırılamadı:', deleteError)
          return NextResponse.json({ error: 'Profil kaldırılamadı.' }, { status: 500 })
        }
        const { error: photoError } = await admin.storage.from('dating-photos').remove([profile.photo_path])
        if (photoError) {
          console.error('Kaldırılan Tanışma profilinin fotoğrafı temizlenemedi:', photoError)
          return NextResponse.json({ error: 'Profil kaldırıldı ancak fotoğraf temizliği tamamlanamadı.' }, { status: 500 })
        }
      }
    }

    const { error: updateError } = await admin.from('dating_reports')
      .update({ status: action === 'remove' ? 'removed' : 'reviewed' })
      .eq('id', report.id)
    if (updateError) {
      console.error('Tanışma bildirimi durumu güncellenemedi:', updateError)
      return NextResponse.json({ error: 'Bildirim durumu kaydedilemedi.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tanışma bildirimi işlenemedi:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Bildirim işlenemedi.' },
      { status: 500 },
    )
  }
}
