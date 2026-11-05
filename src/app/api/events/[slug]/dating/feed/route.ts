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

export async function GET(request: Request, { params }: RouteContext) {
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

    const admin = createDatingAdminClient()
    const [{ data: allProfiles, error: profilesError }, { data: likes, error: likesError }, { data: blocks, error: blocksError }, { data: matches, error: matchesError }] =
      await Promise.all([
        admin.from('guest_profiles')
          .select('id, event_id, first_name, last_name, age, photo_path, bio, contact_type, contact_value, created_at, guest_token_hash')
          .eq('event_id', event.id)
          .neq('id', ownProfile.id)
          .limit(200),
        admin.from('dating_likes').select('liked_profile_id, liked').eq('event_id', event.id).eq('liker_profile_id', ownProfile.id),
        admin.from('dating_blocks').select('blocker_profile_id, blocked_profile_id').eq('event_id', event.id)
          .or(`blocker_profile_id.eq.${ownProfile.id},blocked_profile_id.eq.${ownProfile.id}`),
        admin.from('dating_matches').select('profile_a, profile_b').eq('event_id', event.id)
          .or(`profile_a.eq.${ownProfile.id},profile_b.eq.${ownProfile.id}`),
      ])

    if (profilesError || likesError || blocksError || matchesError) {
      console.error('Tanışma profilleri alınamadı:', profilesError ?? likesError ?? blocksError ?? matchesError)
      return NextResponse.json({ error: 'Profiller yüklenemedi. Lütfen tekrar deneyin.' }, { status: 500 })
    }

    const hiddenIds = new Set<string>([
      ownProfile.id,
      ...(likes ?? []).map((like) => like.liked_profile_id),
      ...(blocks ?? []).flatMap((block) => [block.blocker_profile_id, block.blocked_profile_id]),
    ])
    const profiles = (allProfiles ?? []) as GuestProfile[]
    const matchesByOtherId = new Map<string, GuestProfile>()
    for (const match of matches ?? []) {
      const otherId = match.profile_a === ownProfile.id ? match.profile_b : match.profile_a
      const otherProfile = profiles.find((profile) => profile.id === otherId)
      if (otherProfile) matchesByOtherId.set(otherId, otherProfile)
    }

    const candidates = await Promise.all(
      profiles
        .filter((profile) => !hiddenIds.has(profile.id))
        .slice(0, 40)
        .map(async (profile) => publicProfile(profile, await getSignedPhotoUrl(profile.photo_path))),
    )
    const matchedProfiles = await Promise.all(
      [...matchesByOtherId.values()].map(async (profile) =>
        publicProfile(profile, await getSignedPhotoUrl(profile.photo_path), true)),
    )
    const likedIds = new Set((likes ?? []).filter((like) => like.liked).map((like) => like.liked_profile_id))
    const blockedIds = new Set((blocks ?? []).flatMap((block) => [block.blocker_profile_id, block.blocked_profile_id]))
    const likedProfiles = await Promise.all(
      profiles
        .filter((profile) => likedIds.has(profile.id) && !blockedIds.has(profile.id))
        .map(async (profile) =>
          publicProfile(profile, await getSignedPhotoUrl(profile.photo_path), matchesByOtherId.has(profile.id))),
    )
    return NextResponse.json({ candidates, matches: matchedProfiles, liked: likedProfiles })
  } catch (error) {
    console.error('Tanışma profilleri yüklenemedi:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profiller yüklenemedi.' },
      { status: 500 },
    )
  }
}
