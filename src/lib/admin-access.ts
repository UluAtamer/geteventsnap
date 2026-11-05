import type { User } from '@/lib/db/core'

export function isAdminUser(user: Pick<User, 'id' | 'is_admin'> | null, configuredId = process.env.ADMIN_USER_ID) {
  if (!user) return false
  return user.is_admin === true || (!!configuredId?.trim() && user.id === configuredId.trim())
}
