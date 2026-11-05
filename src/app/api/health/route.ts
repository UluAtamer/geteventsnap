import { NextResponse } from 'next/server'
import { database } from '@/lib/db/core'

export const runtime = 'nodejs'
export async function GET() {
  try {
    await database().prepare('SELECT 1 FROM schema_migrations LIMIT 1').get()
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
