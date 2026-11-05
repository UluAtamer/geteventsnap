'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/db/admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getReturnTo(formData: FormData) {
  const value = String(formData.get('returnTo') ?? '')
  return /^\/admin\/uye\?kod=GES-[0-9A-F]{8}$/.test(value) ? value : '/admin'
}

function returnWithMessage(message: string, returnTo = '/admin'): never {
  revalidatePath('/admin')
  revalidatePath('/admin/uye')
  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}notice=${message}`)
}

export async function updateEvent(formData: FormData) {
  await requireAdmin()
  const returnTo = getReturnTo(formData)
  const eventId = String(formData.get('eventId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const eventDate = String(formData.get('eventDate') ?? '').trim()

  if (!uuidPattern.test(eventId) ||
    title.length < 2 || title.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    Number.isNaN(Date.parse(`${eventDate}T00:00:00Z`)) ||
    new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate) {
    returnWithMessage('invalid', returnTo)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('events')
    .update({ title, event_date: eventDate })
    .eq('id', eventId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Yönetici etkinlik güncellemesi başarısız:', error)
    returnWithMessage('save_failed', returnTo)
  }
  if (!data) {
    returnWithMessage('event_not_found', returnTo)
  }

  returnWithMessage('event_saved', returnTo)
}

export async function setUserAccess(formData: FormData) {
  const currentAdmin = await requireAdmin()
  const userId = String(formData.get('userId') ?? '')
  const action = String(formData.get('action') ?? '')

  if (!uuidPattern.test(userId) || !['ban', 'unban'].includes(action)) {
    returnWithMessage('invalid')
  }

  if (userId === currentAdmin.id) {
    returnWithMessage('self_protected')
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: action === 'ban' ? '876000h' : 'none',
  })

  if (error) {
    console.error('Yönetici hesap erişim işlemi başarısız:', error)
    returnWithMessage('user_action_failed')
  }

  returnWithMessage(action === 'ban' ? 'user_banned' : 'user_unbanned')
}

export async function deleteEvent(formData: FormData) {
  await requireAdmin()
  const returnTo = getReturnTo(formData)
  const eventId = String(formData.get('eventId') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '')

  if (!uuidPattern.test(eventId) || confirmation !== 'ETKİNLİĞİ SİL') {
    returnWithMessage('confirmation_required', returnTo)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('events')
    .delete()
    .eq('id', eventId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Yönetici etkinlik silme işlemi başarısız:', error)
    returnWithMessage('delete_failed', returnTo)
  }
  if (!data) {
    returnWithMessage('event_not_found', returnTo)
  }

  returnWithMessage('event_deleted', returnTo)
}

export async function deleteUser(formData: FormData) {
  const currentAdmin = await requireAdmin()
  const userId = String(formData.get('userId') ?? '')
  const confirmationEmail = String(formData.get('confirmationEmail') ?? '').trim().toLowerCase()

  if (!uuidPattern.test(userId) || !confirmationEmail) {
    returnWithMessage('confirmation_required')
  }

  if (userId === currentAdmin.id) {
    returnWithMessage('self_protected')
  }

  const admin = createAdminClient()
  const { data: { user }, error: lookupError } = await admin.auth.admin.getUserById(userId)

  if (lookupError || !user?.email) {
    console.error('Yönetici silme öncesi hesap doğrulaması başarısız:', lookupError)
    returnWithMessage('user_action_failed')
  }

  if (user.email.toLowerCase() !== confirmationEmail) {
    returnWithMessage('confirmation_required')
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error('Yönetici kullanıcı silme işlemi başarısız:', error)
    returnWithMessage('delete_failed')
  }

  returnWithMessage('user_deleted')
}
