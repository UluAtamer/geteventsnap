'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/admin-auth'
import { getMemberCode } from '@/lib/member-code'
import { createAdminClient } from '@/lib/db/admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createEventForMember(formData: FormData) {
  await requireAdmin()
  const ownerId = String(formData.get('ownerId') ?? '')
  const memberUrl = `/admin/uye?kod=${getMemberCode(ownerId)}`
  const fail = (notice: string): never => redirect(`${memberUrl}&notice=${notice}`)

  if (!uuidPattern.test(ownerId)) redirect('/admin')

  const title = String(formData.get('title') ?? '').trim()
  const eventDate = String(formData.get('event_date') ?? '').trim()
  const eventTime = String(formData.get('event_time') ?? '').trim()
  const eventAddress = String(formData.get('event_address') ?? '').trim()
  const eventType = String(formData.get('event_type') ?? '').trim()
  const welcomeMessage = String(formData.get('welcome_message') ?? '').trim()

  if (title.length < 2 || title.length > 100 ||
    !['dugun', 'arkadas', 'parti', 'diger'].includes(eventType) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate ||
    welcomeMessage.length > 500 || eventAddress.length > 300 ||
    (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime))) {
    fail('invalid')
  }

  const admin = createAdminClient()
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(ownerId)
  if (userError || !user) fail('member_not_found')

  const { error } = await admin.from('events').insert({
    owner_id: ownerId,
    title,
    event_date: eventDate,
    event_time: eventTime || null,
    event_address: eventAddress || null,
    event_type: eventType,
    slug: randomBytes(24).toString('hex'),
    welcome_message: welcomeMessage,
    cover_image_url: `/covers/${eventType}.svg`,
  })
  if (error) {
    console.error('Yönetici üye için etkinlik oluşturamadı:', error)
    fail('save_failed')
  }

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  redirect(`${memberUrl}&notice=member_event_created`)
}
