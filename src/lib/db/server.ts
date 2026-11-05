import 'server-only'
import { cookies } from 'next/headers'
import { Query, rpc } from './core'
import { SESSION_COOKIE, userForSession, revokeSession } from './auth'

export async function createClient() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  const user = await userForSession(token)
  return {
    auth: {
      async getUser() { return { data: { user }, error: null } },
      async getSession() { return { data: { session: user ? { user } : null }, error: null } },
      async signOut() {
        await revokeSession(token)
        cookieStore.delete(SESSION_COOKIE)
        return { error: null }
      },
    },
    from: (table: string) => new Query(table, user?.id || null, false),
    rpc: async (name: string, args = {}) => rpc(name, args, user?.id || null),
  }
}
