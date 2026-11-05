import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export function getAdminEmail() {
  return (process.env.ADMIN_EMAIL || 'ahmetcanatamer@gmail.com').trim().toLowerCase()
}

export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/giris')
  }

  if (user.email?.toLowerCase() !== getAdminEmail()) {
    redirect('/dashboard')
  }

  return user
}
