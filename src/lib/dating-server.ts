import 'server-only'

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export type DatingEvent = {
  id: string
  title: string
  event_date: string
  dating_enabled: boolean
  owner_id: string
}

export type GuestProfile = {
  id: string
  event_id: string
  guest_token_hash: string
  first_name: string
  last_name: string
  age: number
  photo_path: string
  bio: string
  contact_type: 'instagram' | 'phone' | null
  contact_value: string | null
  created_at: string
}

export function createDatingAdminClient() {
  return createAdminClient()
}

export async function getDatingEvent(slug: string): Promise<DatingEvent | null> {
  const { data, error } = await createDatingAdminClient()
    .from('events')
    .select('id, title, event_date, dating_enabled, owner_id')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('Tanışma etkinliği alınamadı:', error)
    throw new Error('Etkinlik bilgisi şu anda alınamıyor.')
  }
  return data as DatingEvent | null
}

export function isDatingEventActive(event: DatingEvent) {
  if (!event.dating_enabled) return false
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const todayInIstanbul = `${date.year}-${date.month}-${date.day}`
  return todayInIstanbul === event.event_date
}

export function getGuestToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) return null
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('Misafir oturumu geçersiz. Sayfayı yenileyip yeniden deneyin.')
  }
  return token.toLowerCase()
}

export function hashGuestToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function isPermissionError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return code === '42501' || /permission denied/i.test(message)
}

export async function getGuestProfile(eventId: string, token: string) {
  const { data, error } = await createDatingAdminClient()
    .from('guest_profiles')
    .select('*')
    .eq('event_id', eventId)
    .eq('guest_token_hash', hashGuestToken(token))
    .maybeSingle()

  if (error) {
    if (isPermissionError(error)) {
      console.warn('Tanışma tablosu erişim izni eksik; profil kontrolü atlandı.')
      return null
    }
    console.error('Misafir Tanışma profili alınamadı:', error)
    throw new Error('Profil bilgisi şu anda alınamıyor.')
  }
  return data as GuestProfile | null
}

export async function getSignedPhotoUrl(photoPath: string) {
  const { data, error } = await createDatingAdminClient()
    .storage
    .from('dating-photos')
    .createSignedUrl(photoPath, 60 * 30)

  if (error || !data?.signedUrl) {
    console.error('Tanışma fotoğrafı için geçici bağlantı oluşturulamadı:', error)
    throw new Error('Profil fotoğrafı şu anda gösterilemiyor.')
  }
  return data.signedUrl
}

export function publicProfile(profile: GuestProfile, photoUrl: string, includeContact = false) {
  const firstName = profile.first_name?.trim() || 'Katılımcı'
  const lastName = profile.last_name?.trim() && profile.last_name.trim() !== firstName ? profile.last_name.trim() : ''

  return {
    id: profile.id,
    firstName,
    lastName,
    age: profile.age || 18,
    bio: profile.bio,
    photoUrl,
    ...(includeContact && profile.contact_type && profile.contact_value
      ? { contact: { type: profile.contact_type, value: profile.contact_value } }
      : {}),
  }
}
