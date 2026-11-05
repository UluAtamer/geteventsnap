import { NextResponse } from 'next/server'
import { database, transaction } from '@/lib/db/core'
import { SESSION_COOKIE, userForSession } from '@/lib/db/auth'
import { isSameOriginRequest } from '@/lib/request-origin'
import { DatingError, cookieValue, cleanupExpiredDating, uuidPattern, readDatingJson } from '@/lib/dating-server'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
function json(body: unknown,status = 200) { return NextResponse.json(body,{ status,headers }) }
async function ownerEvent(request: Request,eventId: string) {
  if (!uuidPattern.test(eventId)) throw new DatingError('Etkinlik geçersiz.',400)
  const user = await userForSession(cookieValue(request,SESSION_COOKIE))
  if (!user) throw new DatingError('Oturum açın.',401)
  await cleanupExpiredDating()
  const event = await database().prepare('SELECT id,slug FROM events WHERE id=? AND owner_id=?').get(eventId,user.id)
  if (!event) throw new DatingError('Etkinlik bulunamadı.',404)
  return event
}
function failure(error: unknown) { return json({ error: error instanceof DatingError ? error.message : 'Bildirim işlemi tamamlanamadı.' },error instanceof DatingError ? error.status : 500) }
export async function GET(request: Request) {
  try {
    const event = await ownerEvent(request,new URL(request.url).searchParams.get('eventId') || '')
    const reports = await database().prepare(`SELECT r.id,r.reason,r.created_at,p.id AS profile_id,p.first_name,p.age
      FROM dating_reports r LEFT JOIN guest_profiles p ON p.id=r.reported_profile_id AND p.event_id=r.event_id
      WHERE r.event_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 100`).all(event.id)
    return json({ reports: reports.map(report => ({ id: report.id, reason: report.reason, createdAt: report.created_at,
      profile: report.profile_id ? { id: report.profile_id, name: report.first_name, age: report.age, photoUrl: `/api/events/${encodeURIComponent(event.slug)}/dating/photos/${report.profile_id}` } : null })) })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) return json({ error: 'Geçersiz kaynak.' },403)
    const body = await readDatingJson(request)
    const event = await ownerEvent(request,String(body.eventId || ''))
    if (!uuidPattern.test(String(body.reportId || '')) || !['remove','dismiss'].includes(body.action)) return json({ error: 'İşlem geçersiz.' },400)
    await transaction(async client => {
      const report = (await client.query("SELECT reported_profile_id FROM dating_reports WHERE id=$1 AND event_id=$2 AND status='pending' FOR UPDATE",[body.reportId,event.id])).rows[0]
      if (!report) throw new DatingError('Bildirim bulunamadı.',404)
      if (body.action === 'remove') await client.query('DELETE FROM guest_profiles WHERE id=$1 AND event_id=$2',[report.reported_profile_id,event.id])
      await client.query('UPDATE dating_reports SET status=$1 WHERE id=$2',[body.action === 'remove' ? 'removed' : 'reviewed',body.reportId])
    })
    return json({ success: true })
  } catch (error) { return failure(error) }
}
