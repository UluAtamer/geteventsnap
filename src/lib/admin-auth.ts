import 'server-only'

import { isAdminUser } from '@/lib/admin-access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/db/server'

export async function requireAdmin() {
  const database = await createClient()
  const { data: { user }, error } = await database.auth.getUser()

  if (error || !user) {
    redirect('/giris')
  }

  if (!isAdminUser(user)) {
    redirect('/dashboard')
  }

  return user
}
