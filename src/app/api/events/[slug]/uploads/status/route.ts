import { NextResponse } from 'next/server'
import { database } from '@/lib/db/core'
import { getEventUploadWindow } from '@/lib/event-upload-window'

export const runtime = 'nodejs'
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const event = await database().prepare('SELECT event_date FROM events WHERE slug=?').get((await params).slug)
  return NextResponse.json(event ? { state: getEventUploadWindow(String(event.event_date)).state } : {}, {
    status: event ? 200 : 404, headers: { 'Cache-Control': 'private, no-store' },
  })
}
