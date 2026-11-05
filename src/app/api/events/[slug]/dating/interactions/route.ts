import { NextResponse } from 'next/server'
import {
  createDatingAdminClient,
  getDatingEvent,
  getGuestProfile,
  getGuestToken,
  getSignedPhotoUrl,
  isDatingEventActive,
  publicProfile,
  type GuestProfile,
} from '@/lib/dating-server'

type RouteContext = { params: Promise<{ slug: string }> }

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })
    const token = getGuestToken(request)
    if (!token) return NextResponse.json({ error: 'Misafir oturumu bulunamadı.' }, { status: 401 })
    const ownProfile = await getGuestProfile(event.id, token)
    if (!ownProfile) return NextResponse.json({ error: 'Profil bulunamadı.' }, { status: 404 })

    const body = await request.json() as { profileId?: unknown }
    if (typeof body.profileId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.profileId)) {
      return NextResponse.json({ error: 'Profil bilgisi geçerli değil.' }, { status: 400 })
    }

    const admin = createDatingAdminClient()
    const [profileA, profileB] = [ownProfile.id, body.profileId].sort()
    const [likeResult, matchResult] = await Promise.all([
      admin.from('dating_likes').delete()
        .eq('event_id', event.id)
        .eq('liker_profile_id', ownProfile.id)
        .eq('liked_profile_id', body.profileId),
      admin.from('dating_matches').delete()
        .eq('event_id', event.id)
        .eq('profile_a', profileA)
        .eq('profile_b', profileB),
    ])
    if (likeResult.error || matchResult.error) {
      console.error('Beğeni silinemedi:', likeResult.error ?? matchResult.error)
      return NextResponse.json({ error: 'Beğeni silinemedi. Lütfen tekrar deneyin.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Beğeni silinemedi:', error)
    return NextResponse.json({ error: 'Beğeni silinemedi.' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { slug } = await params
    const event = await getDatingEvent(slug)
    if (!event) return NextResponse.json({ error: 'Etkinlik bulunamadı.' }, { status: 404 })
    if (!isDatingEventActive(event)) {
      return NextResponse.json({ error: 'Tanışma yalnızca etkinlik günü kullanılabilir.' }, { status: 403 })
    }
    const token = getGuestToken(request)
    if (!token) return NextResponse.json({ error: 'Misafir oturumu bulunamadı.' }, { status: 401 })
    const ownProfile = await getGuestProfile(event.id, token)
    if (!ownProfile) return NextResponse.json({ error: 'Önce Tanışma profilinizi oluşturun.' }, { status: 404 })

    const body = await request.json() as { profileId?: unknown; action?: unknown }
    if (typeof body.profileId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.profileId) ||
      !['like', 'pass'].includes(String(body.action))) {
      return NextResponse.json({ error: 'Beğeni bilgisi geçerli değil.' }, { status: 400 })
    }

    const admin = createDatingAdminClient()
    const { data: target, error: targetError } = await admin
      .from('guest_profiles')
      .select('*')
      .eq('id', body.profileId)
      .eq('event_id', event.id)
      .maybeSingle()
    if (targetError) {
      console.error('Beğenilecek Tanışma profili alınamadı:', targetError)
      return NextResponse.json({ error: 'Profil bilgisi alınamadı.' }, { status: 500 })
    }
    if (!target || target.id === ownProfile.id) {
      return NextResponse.json({ error: 'Profil bulunamadı.' }, { status: 404 })
    }

    const { data: block, error: blockError } = await admin.from('dating_blocks')
      .select('id')
      .eq('event_id', event.id)
      .or(`and(blocker_profile_id.eq.${ownProfile.id},blocked_profile_id.eq.${target.id}),and(blocker_profile_id.eq.${target.id},blocked_profile_id.eq.${ownProfile.id})`)
      .limit(1)
      .maybeSingle()
    if (blockError) {
      console.error('Engelleme durumu denetlenemedi:', blockError)
      return NextResponse.json({ error: 'İşlem şu anda yapılamıyor.' }, { status: 500 })
    }
    if (block) return NextResponse.json({ error: 'Bu profil kullanılamıyor.' }, { status: 409 })

    const liked = body.action === 'like'
    const { error: likeError } = await admin.from('dating_likes').upsert({
      event_id: event.id,
      liker_profile_id: ownProfile.id,
      liked_profile_id: target.id,
      liked,
    }, { onConflict: 'event_id,liker_profile_id,liked_profile_id' })
    if (likeError) {
      console.error('Tanışma beğenisi kaydedilemedi:', likeError)
      return NextResponse.json({ error: 'Seçiminiz kaydedilemedi. Lütfen tekrar deneyin.' }, { status: 500 })
    }

    if (!liked) return NextResponse.json({ matched: false })
    const { data: reciprocal, error: reciprocalError } = await admin.from('dating_likes')
      .select('id')
      .eq('event_id', event.id)
      .eq('liker_profile_id', target.id)
      .eq('liked_profile_id', ownProfile.id)
      .eq('liked', true)
      .maybeSingle()
    if (reciprocalError) {
      console.error('Karşılıklı beğeni denetlenemedi:', reciprocalError)
      return NextResponse.json({ error: 'Eşleşme kontrol edilemedi.' }, { status: 500 })
    }
    if (!reciprocal) return NextResponse.json({ matched: false })

    const [profileA, profileB] = [ownProfile.id, target.id].sort()
    const { error: matchError } = await admin.from('dating_matches').upsert({
      event_id: event.id,
      profile_a: profileA,
      profile_b: profileB,
    }, { onConflict: 'event_id,profile_a,profile_b', ignoreDuplicates: true })
    if (matchError) {
      console.error('Karşılıklı Tanışma eşleşmesi kaydedilemedi:', matchError)
      return NextResponse.json({ error: 'Eşleşme kaydedilemedi.' }, { status: 500 })
    }
    const profile = target as GuestProfile
    return NextResponse.json({
      matched: true,
      match: publicProfile(profile, await getSignedPhotoUrl(profile.photo_path), true),
    })
  } catch (error) {
    console.error('Tanışma seçimi kaydedilemedi:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Seçiminiz kaydedilemedi.' },
      { status: 500 },
    )
  }
}
