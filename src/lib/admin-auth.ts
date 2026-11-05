import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/db/server'

export function getAdminUserId() {
  return (process.env.ADMIN_USER_ID || '').trim()
}

export async function requireAdmin() {
  const database = await createClient()
  const { data: { user }, error } = await database.auth.getUser()

  if (error || !user) {
    redirect('/giris')
  }

  if (user.id !== getAdminUserId()) {
    redirect('/dashboard')
  }

  return user
}
