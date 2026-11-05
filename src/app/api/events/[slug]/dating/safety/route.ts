import { NextResponse } from 'next/server'
import {
  createDatingAdminClient,
  getDatingEvent,
  getGuestProfile,
  getGuestToken,
  isDatingEventActive,
} from '@/lib/dating-server'

type RouteContext = { params: Promise<{ slug: string }> }

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })
    if (!isDatingEventActive(event)) {
      return NextResponse.json({ error: 'Bu işlem yalnızca etkinlik günü yapılabilir.' }, { status: 403 })
    }
    const token = getGuestToken(request)
    if (!token) return NextResponse.json({ error: 'Misafir oturumu bulunamadı.' }, { status: 401 })
    const ownProfile = await getGuestProfile(event.id, token)
    if (!ownProfile) return NextResponse.json({ error: 'Profil bulunamadı.' }, { status: 404 })

    const body = await request.json() as { action?: unknown; profileId?: unknown; reason?: unknown }
    const action = String(body.action ?? '')
    if (!['report', 'block'].includes(action) ||
      typeof body.profileId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.profileId)) {
      return NextResponse.json({ error: 'İşlem bilgisi geçerli değil.' }, { status: 400 })
    }

    const admin = createDatingAdminClient()
    const { data: target, error: targetError } = await admin.from('guest_profiles')
      .select('id')
      .eq('id', body.profileId)
      .eq('event_id', event.id)
      .maybeSingle()
    if (targetError) {
      console.error('Güvenlik işlemi için profil alınamadı:', targetError)
      return NextResponse.json({ error: 'Profil bilgisi alınamadı.' }, { status: 500 })
    }
    if (!target || target.id === ownProfile.id) {
      return NextResponse.json({ error: 'Profil bulunamadı.' }, { status: 404 })
    }

    if (action === 'report') {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length < 3 || reason.length > 300) {
        return NextResponse.json({ error: 'Bildirim açıklaması 3–300 karakter olmalıdır.' }, { status: 400 })
      }
      const { error } = await admin.from('dating_reports').insert({
        event_id: event.id,
        reporter_profile_id: ownProfile.id,
        reported_profile_id: target.id,
        reason,
      })
      if (error) {
        console.error('Tanışma bildirimi kaydedilemedi:', error)
        return NextResponse.json({ error: 'Bildirim gönderilemedi.' }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    const { error: blockError } = await admin.from('dating_blocks').upsert({
      event_id: event.id,
      blocker_profile_id: ownProfile.id,
      blocked_profile_id: target.id,
    }, { onConflict: 'event_id,blocker_profile_id,blocked_profile_id', ignoreDuplicates: true })
    if (blockError) {
      console.error('Tanışma profili engellenemedi:', blockError)
      return NextResponse.json({ error: 'Profil engellenemedi.' }, { status: 500 })
    }
    const { error: likesError } = await admin.from('dating_likes').delete()
      .eq('event_id', event.id)
      .or(`and(liker_profile_id.eq.${ownProfile.id},liked_profile_id.eq.${target.id}),and(liker_profile_id.eq.${target.id},liked_profile_id.eq.${ownProfile.id})`)
    const { error: matchesError } = await admin.from('dating_matches').delete()
      .eq('event_id', event.id)
      .or(`and(profile_a.eq.${ownProfile.id},profile_b.eq.${target.id}),and(profile_a.eq.${target.id},profile_b.eq.${ownProfile.id})`)
    if (likesError || matchesError) {
      console.error('Engellenen profillerin eşleşmeleri temizlenemedi:', likesError ?? matchesError)
      return NextResponse.json({ error: 'Profil engellendi ancak eski eşleşmeler temizlenemedi. Lütfen destek alın.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tanışma güvenlik işlemi tamamlanamadı:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'İşlem tamamlanamadı.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })
    const token = getGuestToken(request)
    if (!token) return NextResponse.json({ error: 'Misafir oturumu bulunamadı.' }, { status: 401 })
    const profile = await getGuestProfile(event.id, token)
    if (!profile) return NextResponse.json({ success: true })

    const admin = createDatingAdminClient()
    const { error: deleteError } = await admin.from('guest_profiles')
      .delete()
      .eq('id', profile.id)
      .eq('event_id', event.id)
    if (deleteError) {
      console.error('Tanışma profili silinemedi:', deleteError)
      return NextResponse.json({ error: 'Profil silinemedi. Lütfen tekrar deneyin.' }, { status: 500 })
    }

    const { error: photoError } = await admin.storage.from('dating-photos').remove([profile.photo_path])
    if (photoError) {
      console.error('Silinen Tanışma profilinin fotoğrafı temizlenemedi:', photoError)
      return NextResponse.json({ error: 'Profil silindi ancak fotoğraf temizliği tamamlanamadı. Destek alın.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Tanışma profili silinemedi:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profil silinemedi.' },
      { status: 500 },
    )
  }
}
