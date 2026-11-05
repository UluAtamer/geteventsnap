import { isSameOriginRequest } from '@/lib/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { database, consumeRateLimit } from '@/lib/db/core'
import { SESSION_COOKIE, userForSession } from '@/lib/db/auth'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
type Context = { params: Promise<{ path: string[] }> }
async function authorize(request: NextRequest, context: Context, mutation = false) {
  if (mutation && !isSameOriginRequest(request)) return null
  const user = await userForSession(request.cookies.get(SESSION_COOKIE)?.value)
  const path = (await context.params).path.join('/')
  if (!user || !path.startsWith(user.id + '/') || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return null
  return { user, path }
}
export async function GET(request: NextRequest, context: Context) {
  const access = await authorize(request, context)
  if (!access) return new NextResponse(null, { status: 404, headers })
  const row = await database().prepare('SELECT content,content_type FROM covers WHERE path=? AND owner_id=?').get(access.path, access.user.id)
  if (!row) return new NextResponse(null, { status: 404, headers })
  return new NextResponse(new Uint8Array(row.content as Uint8Array), { headers: { ...headers, 'Content-Type': String(row.content_type) } })
}
export async function PUT(request: NextRequest, context: Context) {
  const access = await authorize(request, context, true)
  if (!access) return new NextResponse(null, { status: 403, headers })
  if (!await consumeRateLimit(`cover:${access.user.id}`, 10)) return new NextResponse(null, { status: 429, headers })
  const contentType = request.headers.get('content-type') || ''
  if (!['image/jpeg','image/png','image/webp'].includes(contentType)) return new NextResponse(null, { status: 400, headers })
  const max = 5 * 1024 * 1024
  if (Number(request.headers.get('content-length') || 0) > max) return new NextResponse(null, { status: 413, headers })
  const reader = request.body?.getReader()
  if (!reader) return new NextResponse(null, { status: 400, headers })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { await reader.cancel(); return new NextResponse(null, { status: 413, headers }) }
    chunks.push(value)
  }
  const content = Buffer.concat(chunks)
  const signatureValid = contentType === 'image/jpeg' ? content.subarray(0,3).equals(Buffer.from([255,216,255]))
    : contentType === 'image/png' ? content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : content.toString('ascii',0,4) === 'RIFF' && content.toString('ascii',8,12) === 'WEBP'
  if (!signatureValid) return new NextResponse(null, { status: 400, headers })
  const db = database()
  const usage = await db.prepare('SELECT coalesce(sum(length(content)),0) AS size FROM covers WHERE owner_id=?').get(access.user.id)
  if (Number(usage?.size) + size > 50 * 1024 * 1024) return new NextResponse(null, { status: 413, headers })
  await db.prepare('INSERT INTO covers(path,owner_id,content_type,content) VALUES (?,?,?,?) ON CONFLICT(path) DO NOTHING').run(access.path, access.user.id, contentType, content)
  return NextResponse.json({ success: true }, { headers })
}
export async function DELETE(request: NextRequest, context: Context) {
  const access = await authorize(request, context, true)
  if (!access) return new NextResponse(null, { status: 403, headers })
  await database().prepare('DELETE FROM covers WHERE path=? AND owner_id=?').run(access.path, access.user.id)
  return new NextResponse(null, { status: 204, headers })
}
