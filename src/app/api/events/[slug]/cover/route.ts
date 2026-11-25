import { NextResponse } from 'next/server'
import { database } from '@/lib/db/core'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Only the cover of the event whose invitation link is being used; the owner's session is not involved.
  const event = await database().prepare('SELECT owner_id,cover_image_url FROM events WHERE slug=?').get((await params).slug)
  const url = String(event?.cover_image_url ?? '')
  const path = url.startsWith('/api/covers/') ? url.slice('/api/covers/'.length) : ''
  if (!event || !path.startsWith(`${event.owner_id}/`) || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return new NextResponse(null, { status: 404, headers })
  const row = await database().prepare('SELECT content,content_type FROM covers WHERE path=? AND owner_id=?').get(path, event.owner_id)
  if (!row) return new NextResponse(null, { status: 404, headers })
  return new NextResponse(new Uint8Array(row.content as Uint8Array), { headers: { ...headers, 'Content-Type': String(row.content_type) } })
}
