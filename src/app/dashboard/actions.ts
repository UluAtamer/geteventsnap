'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type CreateEventResult = {
  error?: string
  eventSlug?: string
}

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function slugify(value: string) {
  const transliteration: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
  }

  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (character) => transliteration[character] ?? character)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/g, '')
}

export async function createEvent(formData: FormData): Promise<CreateEventResult> {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

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

  if (coverImageUrl) {
    const sampleCovers = ['/covers/dugun.svg', '/covers/arkadas.svg', '/covers/parti.svg', '/covers/diger.svg']
    if (!sampleCovers.includes(coverImageUrl)) {
      try {
        const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        if (!projectUrl) {
          throw new Error('Supabase bağlantı ayarı eksik.')
        }
        const parsedUrl = new URL(coverImageUrl)
        const expectedUrl = new URL(projectUrl)
        const ownerCoverPrefix = `/storage/v1/object/public/event-covers/${user.id}/`
        if (parsedUrl.protocol !== 'https:' ||
          parsedUrl.origin !== expectedUrl.origin ||
          !parsedUrl.pathname.startsWith(ownerCoverPrefix) ||
          parsedUrl.search) {
          return { error: 'Kapak görseli etkinlik için telefonunuzdan yüklenmelidir.' }
        }
      } catch {
        return { error: 'Kapak görseli yüklenemedi. Lütfen tekrar seçin.' }
      }
    }
  }

  const safeCoverImageUrl = coverImageUrl || `/covers/${eventType}.svg`
  const baseSlug = slugify(title)
  if (!baseSlug) {
    return { error: 'Etkinlik adı bağlantı oluşturmak için uygun değil.' }
  }

  const slug = `${baseSlug}-${randomBytes(4).toString('hex')}`
  const { data, error } = await supabase
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
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { error: 'Etkinlik veritabanı henüz hazırlanmadı. README dosyasındaki ikinci veritabanı adımını tamamlayın.' }
    }
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

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    redirect('/giris')
  }

  const { data, error } = await supabase
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

export async function updateDatingEnabled(formData: FormData) {
  const eventId = String(formData.get('eventId') ?? '')
  const enabledValue = String(formData.get('enabled') ?? '')
  if (!eventIdPattern.test(eventId) ||
    !['true', 'false'].includes(enabledValue)) {
    redirect('/dashboard?panel=settings_invalid')
  }

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    redirect('/giris')
  }

  const { data, error } = await supabase
    .from('events')
    .update({ dating_enabled: enabledValue === 'true' })
    .eq('id', eventId)
    .eq('owner_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Tanışma ayarı kaydedilemedi:', error)
    redirect('/dashboard?panel=settings_save_failed')
  }
  if (!data) {
    redirect('/dashboard?panel=event_not_found')
  }

  revalidatePath('/dashboard')
  redirect(`/dashboard?panel=dating_${enabledValue}`)
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

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.' }
  }

  const sampleCovers = ['/covers/dugun.svg', '/covers/arkadas.svg', '/covers/parti.svg', '/covers/diger.svg']
  if (!sampleCovers.includes(coverImageUrl)) {
    try {
      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!projectUrl) throw new Error('Supabase bağlantı ayarı eksik.')
      const parsedUrl = new URL(coverImageUrl)
      const expectedUrl = new URL(projectUrl)
      const ownerCoverPrefix = `/storage/v1/object/public/event-covers/${user.id}/`
      if (parsedUrl.protocol !== 'https:' ||
        parsedUrl.origin !== expectedUrl.origin ||
        !parsedUrl.pathname.startsWith(ownerCoverPrefix) ||
        parsedUrl.search ||
        parsedUrl.hash) {
        return { error: 'Arka plan fotoğrafı bu hesaba ait değil. Lütfen yeniden seçin.' }
      }
    } catch {
      return { error: 'Arka plan fotoğrafı geçerli değil. Lütfen yeniden seçin.' }
    }
  }

  const { data, error } = await supabase
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
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw new Error('Çıkış yapılamadı. Lütfen tekrar deneyin.')
  }

  redirect('/giris')
}
