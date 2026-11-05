import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { database, transaction, consumeRateLimit, type Row } from '@/lib/db/core'
import { getIstanbulDate } from '@/lib/event-upload-window'

export class DatingError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export const DATING_COOKIE = 'eventsnap_dating'
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export const hashGuestToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function cookieValue(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}
export function getGuestToken(request: Request) {
  const header = request.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieValue(request, DATING_COOKIE)
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null
}
export async function cleanupExpiredDating() {
  const today = getIstanbulDate()
  await transaction(async client => {
    await client.query('DELETE FROM guest_profiles WHERE event_id IN (SELECT id FROM events WHERE event_date < $1)', [today])
    await client.query('DELETE FROM dating_reports WHERE event_id IN (SELECT id FROM events WHERE event_date < $1)', [today])
  })
}
export async function getDatingEvent(slug: string) {
  await cleanupExpiredDating()
  const event = await database().prepare('SELECT id,owner_id,event_date,dating_enabled FROM events WHERE slug=?').get(slug)
  if (!event) throw new DatingError('Etkinlik bulunamadı.', 404)
  return event
}
export function isDatingEventActive(event: Row) {
  return event.dating_enabled === true && event.event_date === getIstanbulDate()
}
export async function getGuestProfile(eventId: string, token: string) {
  return database().prepare(`SELECT id,event_id,first_name,age,bio,contact_type,contact_value,created_at
    FROM guest_profiles WHERE event_id=? AND guest_token_hash=?`).get(eventId, hashGuestToken(token))
}
export async function requireDatingProfile(request: Request, event: Row, active = true) {
  if (active && !isDatingEventActive(event)) throw new DatingError('Tanışma yalnızca etkinlik günü ve etkinlik sahibi açtığında kullanılabilir.', 403)
  const token = getGuestToken(request)
  if (!token) throw new DatingError('Tanışma oturumunuz bulunamadı.', 401)
  const profile = await getGuestProfile(event.id, token)
  if (!profile) throw new DatingError('Önce Tanışma profilinizi oluşturun.', 401)
  return profile
}
export function participantProfile(profile: Row, slug: string, contact = false) {
  return {
    id: profile.id, firstName: profile.first_name, lastName: '', age: profile.age, bio: profile.bio,
    photoUrl: `/api/events/${encodeURIComponent(slug)}/dating/photos/${profile.id}`,
    ...(contact && profile.contact_type && profile.contact_value ? { contact: { type: profile.contact_type, value: profile.contact_value } } : {}),
  }
}
export async function areBlocked(eventId: string, a: string, b: string) {
  return !!await database().prepare(`SELECT 1 FROM dating_blocks WHERE event_id=?
    AND ((blocker_profile_id=? AND blocked_profile_id=?) OR (blocker_profile_id=? AND blocked_profile_id=?))`).get(eventId, a, b, b, a)
}
export async function datingFeed(event: Row, own: Row, slug: string) {
  const profiles = await database().prepare(`SELECT p.id,p.first_name,p.age,p.bio,p.contact_type,p.contact_value,
    l.liked AS chosen, m.profile_a AS matched FROM guest_profiles p
    LEFT JOIN dating_likes l ON l.event_id=p.event_id AND l.liker_profile_id=? AND l.liked_profile_id=p.id
    LEFT JOIN dating_matches m ON m.event_id=p.event_id AND ((m.profile_a=? AND m.profile_b=p.id) OR (m.profile_b=? AND m.profile_a=p.id))
    WHERE p.event_id=? AND p.id<>? AND NOT EXISTS (SELECT 1 FROM dating_blocks b WHERE b.event_id=p.event_id
      AND ((b.blocker_profile_id=? AND b.blocked_profile_id=p.id) OR (b.blocked_profile_id=? AND b.blocker_profile_id=p.id)))
    ORDER BY p.created_at LIMIT 200`).all(own.id, own.id, own.id, event.id, own.id, own.id, own.id)
  return {
    candidates: profiles.filter(profile => profile.chosen === null && !profile.matched).slice(0,40).map(profile => participantProfile(profile, slug)),
    liked: profiles.filter(profile => profile.chosen === true).map(profile => participantProfile(profile, slug, !!profile.matched)),
    matches: profiles.filter(profile => profile.matched).map(profile => participantProfile(profile, slug, true)),
  }
}
export async function enforceDatingRateLimit(request: Request, event: Row, creating = false) {
  const token = getGuestToken(request) || ''
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const key = hashGuestToken(`${event.id}:${creating ? ip : token || ip}`)
  if (!await consumeRateLimit(`dating:${creating ? 'create' : 'request'}:${key}`, creating ? 3 : 60)) throw new DatingError('Çok fazla işlem yaptınız. Bir dakika bekleyin.', 429)
}

export async function boundedBody(request: Request, maximum: number) {
  if (Number(request.headers.get('content-length') || 0) > maximum) throw new DatingError('Gönderilen içerik çok büyük.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new DatingError('İstek boş.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maximum) { await reader.cancel(); throw new DatingError('Gönderilen içerik çok büyük.', 413) }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
export async function readDatingJson(request: Request) {
  try { return JSON.parse((await boundedBody(request, 4096)).toString('utf8')) as Row }
  catch (error) { if (error instanceof DatingError) throw error; throw new DatingError('İstek geçersiz.') }
}
export async function createDatingProfile(request: Request, event: Row, token: string) {
  if (!isDatingEventActive(event)) throw new DatingError('Tanışma yalnızca etkinlik günü kullanılabilir.', 403)
  const body = await boundedBody(request, 5 * 1024 * 1024 + 16384)
  const form = await new Request(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array(body) }).formData()
  const firstName = String(form.get('firstName') || '').trim()
  const age = Number(form.get('age'))
  const bio = String(form.get('bio') || '').trim()
  const contactValue = String(form.get('contactValue') || '').trim()
  const contactType = contactValue ? String(form.get('contactType') || '') : null
  if (!firstName || firstName.length > 40 || !Number.isInteger(age) || age < 18 || age > 120 || bio.length > 240 || form.get('consent') !== 'true') throw new DatingError('Takma adınızı, 18 yaş ve üzeri yaşınızı ve açık rıza onayınızı kontrol edin.')
  if (contactValue && (contactValue.length > 80 || !['instagram','phone'].includes(contactType || '') ||
    (contactType === 'instagram' && !/^@?[A-Za-z0-9._]{1,30}$/.test(contactValue)) ||
    (contactType === 'phone' && (!/^[+()\d\s.-]{7,24}$/.test(contactValue) || contactValue.replace(/\D/g,'').length < 7)))) throw new DatingError('İletişim bilgisini kontrol edin.')
  const photo = form.get('photo')
  if (!(photo instanceof File) || photo.size < 1 || photo.size > 5 * 1024 * 1024) throw new DatingError('5 MB veya daha küçük bir profil fotoğrafı seçin.')
  const bytes = Buffer.from(await photo.arrayBuffer())
  const valid = photo.type === 'image/jpeg' ? bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
    : photo.type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : photo.type === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
  if (!valid) throw new DatingError('Fotoğraf JPEG, PNG veya WebP biçiminde olmalı.')
  return transaction(async client => {
    // Lock the event to serialize capacity checks and avoid duplicate simultaneous profiles.
    const current = (await client.query('SELECT event_date,dating_enabled FROM events WHERE id=$1 FOR UPDATE', [event.id])).rows[0]
    if (!current || !isDatingEventActive(current)) throw new DatingError('Tanışma kapalı.', 403)
    const existing = await client.query('SELECT id FROM guest_profiles WHERE event_id=$1 AND guest_token_hash=$2', [event.id, hashGuestToken(token)])
    if (existing.rows.length) throw new DatingError('Bu tarayıcıda zaten bir profil var.', 409)
    const count = await client.query('SELECT count(*) AS count FROM guest_profiles WHERE event_id=$1', [event.id])
    if (Number(count.rows[0].count) >= 200) throw new DatingError('Etkinliğin Tanışma katılım sınırına ulaşıldı.', 409)
    const now = new Date().toISOString()
    const result = await client.query(`INSERT INTO guest_profiles(id,event_id,guest_token_hash,first_name,age,bio,contact_type,contact_value,photo_type,photo_content,consented_at,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id,first_name,age,bio`, [randomUUID(),event.id,hashGuestToken(token),firstName,age,bio,contactType,contactValue || null,photo.type,bytes,now])
    return result.rows[0]
  })
}

export async function interact(event: Row, own: Row, targetId: string, action: 'like' | 'pass' | 'remove', slug: string) {
  return transaction(async client => {
    // Sorted row locks serialize reciprocal likes and block operations for this pair.
    const locked = await client.query('SELECT id,first_name,age,bio,contact_type,contact_value FROM guest_profiles WHERE event_id=$1 AND id IN ($2,$3) ORDER BY id FOR UPDATE', [event.id,own.id,targetId])
    const target = locked.rows.find(row => row.id === targetId)
    if (locked.rows.length !== 2 || !target || own.id === targetId) throw new DatingError('Profil bulunamadı.',404)
    const block = await client.query('SELECT 1 FROM dating_blocks WHERE event_id=$1 AND ((blocker_profile_id=$2 AND blocked_profile_id=$3) OR (blocker_profile_id=$3 AND blocked_profile_id=$2))', [event.id,own.id,targetId])
    if (block.rows.length) throw new DatingError('Profil kullanılamıyor.',404)
    const [a,b] = [own.id,targetId].sort()
    if (action === 'remove') await client.query('DELETE FROM dating_likes WHERE event_id=$1 AND liker_profile_id=$2 AND liked_profile_id=$3', [event.id,own.id,targetId])
    else await client.query(`INSERT INTO dating_likes(event_id,liker_profile_id,liked_profile_id,liked) VALUES ($1,$2,$3,$4)
      ON CONFLICT(event_id,liker_profile_id,liked_profile_id) DO UPDATE SET liked=excluded.liked`, [event.id,own.id,targetId,action === 'like'])
    if (action !== 'like') {
      await client.query('DELETE FROM dating_matches WHERE event_id=$1 AND profile_a=$2 AND profile_b=$3', [event.id,a,b])
      return { matched: false }
    }
    const reciprocal = await client.query('SELECT 1 FROM dating_likes WHERE event_id=$1 AND liker_profile_id=$2 AND liked_profile_id=$3 AND liked=TRUE', [event.id,targetId,own.id])
    if (!reciprocal.rows.length) return { matched: false }
    await client.query('INSERT INTO dating_matches(event_id,profile_a,profile_b) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [event.id,a,b])
    return { matched: true, match: participantProfile(target,slug,true) }
  })
}

export async function protectParticipant(event: Row, own: Row, targetId: string, action: string, reason: string) {
  return transaction(async client => {
    const locked = await client.query('SELECT id FROM guest_profiles WHERE event_id=$1 AND id IN ($2,$3) ORDER BY id FOR UPDATE', [event.id,own.id,targetId])
    if (locked.rows.length !== 2 || targetId === own.id) throw new DatingError('Profil bulunamadı.',404)
    if (action === 'report') {
      if (reason.length < 3 || reason.length > 300) throw new DatingError('Bildirim açıklaması 3–300 karakter olmalı.')
      await client.query('INSERT INTO dating_reports(id,event_id,reporter_profile_id,reported_profile_id,reason,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(),event.id,own.id,targetId,reason,new Date().toISOString()])
    } else if (action === 'block') {
      await client.query('INSERT INTO dating_blocks(event_id,blocker_profile_id,blocked_profile_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [event.id,own.id,targetId])
      await client.query('DELETE FROM dating_likes WHERE event_id=$1 AND ((liker_profile_id=$2 AND liked_profile_id=$3) OR (liker_profile_id=$3 AND liked_profile_id=$2))', [event.id,own.id,targetId])
      const [a,b] = [own.id,targetId].sort()
      await client.query('DELETE FROM dating_matches WHERE event_id=$1 AND profile_a=$2 AND profile_b=$3', [event.id,a,b])
    } else throw new DatingError('İşlem geçersiz.')
  })
}
