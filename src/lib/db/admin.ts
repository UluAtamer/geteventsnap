import 'server-only'
import { Query, rpc } from './core'
import { userAdmin } from './auth'

// Internal capability: route handlers must authorize the user or upload ticket first.
// This module is never exposed through a generic HTTP query endpoint.
export function createAdminClient() {
  return {
    from: (table: string) => new Query(table, null, true),
    rpc: async (name: string, args = {}) => rpc(name, args, null, true),
    auth: { admin: userAdmin },
  }
}
