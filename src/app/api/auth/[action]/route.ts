import { isUiPreview } from '@/lib/ui-preview'
import { isSameOriginRequest } from '@/lib/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/db/core'
import { changePassword, createSession, login, register, revokeSession, SESSION_COOKIE, SESSION_SECONDS, tokenHash, userForSession } from '@/lib/db/auth'

export const runtime = 'nodejs'
const privateHeaders = { 'Cache-Control': 'no-store, private' }
function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: privateHeaders }) }
function sessionResponse(user: unknown, token: string) {
  const response = reply({ data: { user, session: { user } }, error: null })
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS })
  return response
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== 'user') return reply({ error: { message: 'Bulunamadı.' } }, 404)
  const user = await userForSession(request.cookies.get(SESSION_COOKIE)?.value)
  return reply({ data: { user }, error: null })
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (isUiPreview()) return reply({ error: { message: 'Arayüz önizlemesinde hesap işlemleri kapalı.' } }, 503)
  if (!isSameOriginRequest(request)) return reply({ error: { message: 'Geçersiz kaynak.' } }, 403)
  if (Number(request.headers.get('content-length') || 0) > 4096) return reply({ error: { message: 'İstek çok büyük.' } }, 413)
  const { action } = await params
  if (!['signup','login','logout','password'].includes(action)) return reply({ error: { message: 'Bulunamadı.' } }, 404)
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4096) return reply({ error: { message: 'İstek çok büyük.' } }, 413)
    const body = JSON.parse(raw)
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (action === 'logout') {
      await revokeSession(token)
      const response = reply({ data: {}, error: null })
      response.cookies.delete(SESSION_COOKIE)
      return response
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const rateKey = tokenHash(action === 'password' ? token || 'anonymous' : email)
    if (!await consumeRateLimit(`auth:${action}:${rateKey}`, 8) || !await consumeRateLimit('auth:global', 120)) {
      return reply({ error: { message: 'Çok fazla deneme. Bir dakika bekleyin.' } }, 429)
    }
    if (password.length < 12 || password.length > 128) return reply({ error: { message: 'Parola 12–128 karakter olmalı.' } }, 400)
    if (action === 'password') {
      const user = await userForSession(token)
      if (!user || typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 ||
          !await changePassword(user, body.currentPassword, password)) return reply({ error: { message: 'Oturum veya mevcut parola geçersiz.' } }, 401)
      return sessionResponse(user, await createSession(user.id))
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply({ error: { message: 'Geçerli bir e-posta yazın.' } }, 400)
    if (action === 'signup') {
      const user = await register(email, password)
      await revokeSession(token)
      return sessionResponse(user, await createSession(user.id))
    }
    const user = await login(email, password)
    if (!user) return reply({ error: { message: 'E-posta veya parola hatalı.' } }, 401)
    await revokeSession(token)
    return sessionResponse(user, await createSession(user.id))
  } catch {
    return reply({ error: { message: 'İşlem tamamlanamadı. Bilgilerinizi kontrol edin.' } }, 400)
  }
}
