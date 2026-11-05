'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isOwnedCover } from '@/lib/cover-url'
import { createClient } from '@/lib/db/server'

export type CreateEventResult = {
  error?: string
  eventSlug?: string
}

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  const database = await createClient()
  const { data: { user }, error: userError } = await database.auth.getUser()

  if (userError || !user) {
    return { error: 'Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.' }
  }

  const title = String(formData.get('title') ?? '').trim()
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const eventTime = String(formData.get('event_time') ?? '').trim()
  const eventAddress = String(formData.get('event_address') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const welcomeMessage = String(formData.get('welcome_message') ?? '').trim()
  const coverImageUrl = String(formData.get('cover_image_url') ?? '').trim()

  if (title.length < 2 || title.length > 100) {
    return { error: 'Etkinlik adı 2 ile 100 karakter arasında olmalı.' }
  }

  if (!['dugun', 'arkadas', 'parti', 'diger'].includes(eventType)) {
    return { error: 'Lütfen etkinlik türlerinden birini seçin.' }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) ||
    new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate) {
    return { error: 'Lütfen geçerli bir etkinlik tarihi seçin.' }
  }

  if (welcomeMessage.length > 500) {
    return { error: 'Hoş geldiniz mesajı en fazla 500 karakter olabilir.' }
  }

  if (eventAddress.length > 300) {
    return { error: 'Etkinlik adresi en fazla 300 karakter olabilir.' }
  }
  if (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) {
    return { error: 'Lütfen geçerli bir etkinlik saati girin.' }
  }

  if (coverImageUrl && !isOwnedCover(coverImageUrl, user.id)) {
    return { error: 'Kapak görseli bu hesaba ait değil.' }
  }

  const safeCoverImageUrl = coverImageUrl || `/covers/${eventType}.svg`
  const slug = randomBytes(24).toString('hex')
  const { data, error } = await database
    .from('events')
    .insert({
      owner_id: user.id,
      title,
      event_date: eventDate,
      event_time: eventTime || null,
      event_address: eventAddress || null,
      event_type: eventType,
      slug,
      welcome_message: welcomeMessage,
      cover_image_url: safeCoverImageUrl,
    })
    .select('slug')
    .single()

  if (error) {
    console.error('Etkinlik oluşturulamadı:', error)
    return { error: 'Etkinlik oluşturulamadı. Lütfen bilgileri kontrol edip tekrar deneyin.' }
  }

  revalidatePath('/dashboard')
  return { eventSlug: data.slug }
}

export async function deleteOwnedEvent(formData: FormData) {
  const eventId = String(formData.get('eventId') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '')
  if (!eventIdPattern.test(eventId) || confirmation !== 'ETKİNLİĞİ SİL') {
    redirect('/dashboard?panel=event_delete_confirmation')
  }

  const database = await createClient()
  const { data: { user }, error: userError } = await database.auth.getUser()
  if (userError || !user) {
    redirect('/giris')
  }

  const { data, error } = await database
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .select('id, slug')
    .maybeSingle()

  if (error) {
    console.error('Etkinlik sahibi etkinlik silemedi:', error)
    redirect('/dashboard?panel=event_delete_failed')
  }
  if (!data) {
    redirect('/dashboard?panel=event_not_found')
  }

  revalidatePath('/dashboard')
  revalidatePath(`/e/${data.slug}`)
  redirect('/dashboard?panel=event_deleted')
}

export async function updateOwnedEvent(formData: FormData): Promise<CreateEventResult> {
  const eventId = String(formData.get('eventId') ?? '')
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const eventTime = String(formData.get('event_time') ?? '').trim()
  const eventAddress = String(formData.get('event_address') ?? '').trim()
  const welcomeMessage = String(formData.get('welcome_message') ?? '').trim()
  const coverImageUrl = String(formData.get('cover_image_url') ?? '').trim()

  if (!eventIdPattern.test(eventId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) ||
    new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate ||
    (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) ||
    eventAddress.length > 300 ||
    welcomeMessage.length > 500 ||
    !coverImageUrl) {
    return { error: 'Etkinlik tarihi, saati, açıklaması veya arka plan görseli geçerli değil.' }
  }

  const database = await createClient()
  const { data: { user }, error: userError } = await database.auth.getUser()
  if (userError || !user) {
    return { error: 'Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.' }
  }

  if (!isOwnedCover(coverImageUrl, user.id)) {
    return { error: 'Kapak görseli bu hesaba ait değil.' }
  }

  const { data, error } = await database
    .from('events')
    .update({
      event_date: eventDate,
      event_time: eventTime || null,
      event_address: eventAddress || null,
      welcome_message: welcomeMessage,
      cover_image_url: coverImageUrl,
    })
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .select('id, slug')
    .maybeSingle()

  if (error) {
    console.error('Etkinlik bilgileri kaydedilemedi:', error)
    return { error: 'Etkinlik bilgileri kaydedilemedi. Lütfen tekrar deneyin.' }
  }
  if (!data) {
    return { error: 'Etkinlik bulunamadı veya bu etkinlik size ait değil.' }
  }

  revalidatePath('/dashboard')
  revalidatePath(`/e/${data.slug}`)
  return { eventSlug: data.slug }
}

export async function signOut() {
  const database = await createClient()
  const { error } = await database.auth.signOut()

  if (error) {
    throw new Error('Çıkış yapılamadı. Lütfen tekrar deneyin.')
  }

  redirect('/giris')
}


export async function updateDatingEnabled(formData: FormData) {
  const eventId = String(formData.get('eventId') || '')
  const enabled = String(formData.get('enabled') || '')
  if (!eventIdPattern.test(eventId) || !['true','false'].includes(enabled)) redirect('/dashboard?panel=settings_invalid')
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/giris')
  const { data,error } = await client.from('events').update({ dating_enabled: enabled === 'true' })
    .eq('id',eventId).eq('owner_id',user.id).select('id,slug').maybeSingle()
  if (error || !data) redirect('/dashboard?panel=settings_save_failed')
  revalidatePath('/dashboard')
  revalidatePath(`/e/${data.slug}`)
  redirect('/dashboard?panel=dating_saved')
}
