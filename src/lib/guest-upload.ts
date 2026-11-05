import 'server-only'

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import { getEventUploadWindow } from '@/lib/event-upload-window'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  decryptGoogleRefreshToken,
  getGoogleDriveOAuthConfig,
} from '@/lib/google-drive'

type AdminClient = ReturnType<typeof createAdminClient>
type JsonObject = Record<string, unknown>

export type GuestUploadLimits = {
  photoBytes: number
  videoBytes: number
}

export type GuestUploadTicket = {
  version: 1
  eventId: string
  eventDate: string
  guestHash: string
  uploadUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  displayName: string
  note: string
  issuedAt: number
}

type UploadEvent = {
  id: string
  title: string
  event_date: string
}

type DriveConnection = {
  owner_id: string
  encrypted_refresh_token: string
  drive_folder_id: string
  connection_status: 'connected' | 'reauth_required'
}

type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string
  parents?: string[]
  description?: string
  createdTime?: string
  trashed?: boolean
}

export class GuestUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'GuestUploadError'
  }
}

function encryptionKey() {
  const value = process.env.DRIVE_TOKEN_ENCRYPTION_KEY
  const key = value ? Buffer.from(value, 'base64') : Buffer.alloc(0)
  if (key.length !== 32) {
    throw new GuestUploadError('Sunucu anahtarları ayarlı değil.', 503, 'server_setup_required')
  }
  return key
}

function configuredLimit(variable: string, fallback: number) {
  const raw = process.env[variable]
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GuestUploadError(`${variable} değeri geçersiz.`, 503, 'server_setup_required')
  }
  return value
}

export function getGuestUploadLimits(): GuestUploadLimits {
  return {
    photoBytes: configuredLimit('GUEST_MAX_PHOTO_BYTES', 25 * 1024 * 1024),
    videoBytes: configuredLimit('GUEST_MAX_VIDEO_BYTES', 500 * 1024 * 1024),
  }
}

export function uploadFailureResponse(error: unknown, context: string) {
  if (error instanceof GuestUploadError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    )
  }

  console.error(`${context}:`, error)
  return NextResponse.json(
    { error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.', code: 'upload_failed' },
    { status: 500 },
  )
}

export async function readUploadJson(request: Request, maximumBytes = 16_000): Promise<JsonObject> {
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new GuestUploadError('İstek boyutu çok büyük.', 413, 'request_too_large')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new GuestUploadError('İstek biçimi geçersiz.', 400, 'invalid_request')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GuestUploadError('İstek bilgileri geçersiz.', 400, 'invalid_request')
  }
  return value as JsonObject
}

export function getText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maximumLength)
}

function rateLimitHash(request: Request, eventId: string) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const forwardedAddresses = forwardedFor?.split(',').map((part) => part.trim()).filter(Boolean)
  const candidate = forwardedAddresses?.at(-1) ?? request.headers.get('x-real-ip')?.trim() ?? '127.0.0.1'
  const ip = isIP(candidate) ? candidate : '127.0.0.1'

  return createHmac('sha256', encryptionKey())
    .update(`guest-upload-rate-limit-v1|${eventId}|${ip}`)
    .digest('hex')
}

export async function enforceGuestUploadRateLimit(
  admin: AdminClient,
  request: Request,
  eventId: string,
) {
  const { data, error } = await admin.rpc('consume_guest_upload_rate_limit', {
    p_bucket_hash: rateLimitHash(request, eventId),
    p_max_requests: 40,
  })
  if (error) {
    console.error('Misafir yükleme hız sınırı denetlenemedi:', error)
    throw new GuestUploadError('Yükleme güvenlik denetimi şu anda kullanılamıyor.', 503, 'rate_limit_unavailable')
  }
  if (data !== true) {
    throw new GuestUploadError('Çok sık işlem yapıldı. Bir dakika bekleyip tekrar deneyin.', 429, 'rate_limited')
  }
}

export async function findUploadEvent(admin: AdminClient, slug: string): Promise<UploadEvent> {
  const { data, error } = await admin
    .from('events')
    .select('id, title, event_date')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('Misafir yükleme etkinliği okunamadı:', error)
    throw new GuestUploadError('Etkinlik şu anda açılamıyor.', 503, 'event_unavailable')
  }
  if (!data) {
    throw new GuestUploadError('Etkinlik bulunamadı.', 404, 'event_not_found')
  }
  return data
}

async function parseGoogleJson(response: Response): Promise<JsonObject> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new GuestUploadError(`Google Drive yanıt vermedi (HTTP ${response.status}).`, 502, 'drive_unavailable')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GuestUploadError('Google Drive yanıtı geçersiz.', 502, 'drive_invalid_response')
  }
  return value as JsonObject
}

async function getDriveConnection(admin: AdminClient, eventId: string) {
  const { data, error } = await admin
    .from('event_drive_connections')
    .select('owner_id, encrypted_refresh_token, drive_folder_id, connection_status')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) {
    console.error('Etkinliğin Drive bağlantısı okunamadı:', error)
    throw new GuestUploadError('Drive bağlantısı şu anda denetlenemiyor.', 503, 'drive_unavailable')
  }
  if (!data) {
    throw new GuestUploadError('Etkinlik sahibi henüz Google Drive’ı bağlamadı.', 409, 'drive_not_connected')
  }
  if (data.connection_status !== 'connected') {
    throw new GuestUploadError('Etkinlik sahibinin Google Drive bağlantısını yenilemesi gerekiyor.', 409, 'drive_reauth_required')
  }
  return data as DriveConnection
}

async function getAccessToken(
  admin: AdminClient,
  eventId: string,
  connection: DriveConnection,
  origin: string,
) {
  let refreshToken: string
  try {
    refreshToken = decryptGoogleRefreshToken(connection.encrypted_refresh_token)
  } catch (error) {
    console.error('Şifrelenmiş Drive anahtarı çözülemedi:', error)
    throw new GuestUploadError('Google Drive bağlantısını yenilemek gerekiyor.', 409, 'drive_reauth_required')
  }

  const config = getGoogleDriveOAuthConfig(origin)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  const payload = await parseGoogleJson(response)

  if (!response.ok) {
    if (payload.error === 'invalid_grant') {
      const { error } = await admin
        .from('event_drive_connections')
        .update({ connection_status: 'reauth_required', last_error_at: new Date().toISOString() })
        .eq('event_id', eventId)
      if (error) console.error('Drive yeniden bağlanma durumu kaydedilemedi:', error)
      throw new GuestUploadError('Etkinlik sahibinin Google Drive’ı yeniden bağlaması gerekiyor.', 409, 'drive_reauth_required')
    }
    throw new GuestUploadError(`Google Drive erişimi yenilenemedi (HTTP ${response.status}).`, 502, 'drive_token_refresh_failed')
  }

  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GuestUploadError('Google Drive erişim anahtarı eksik.', 502, 'drive_invalid_response')
  }
  return payload.access_token
}

export async function getGuestUploadContext(
  admin: AdminClient,
  event: UploadEvent,
  origin: string,
) {
  const connection = await getDriveConnection(admin, event.id)
  const accessToken = await getAccessToken(admin, event.id, connection, origin)
  return { connection, accessToken }
}

export function validateGuestUploadWindow(eventDate: string) {
  const window = getEventUploadWindow(eventDate)
  if (window.state === 'not_started') {
    throw new GuestUploadError('Anı yükleme etkinlik günü saat 00.00’da açılacak.', 403, 'upload_not_started')
  }
  if (window.state === 'closed') {
    throw new GuestUploadError('Anı yükleme süresi sona erdi.', 403, 'upload_window_closed')
  }
}

export function hashGuestUploadId(value: unknown, eventId: string) {
  const guestId = getText(value, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guestId)) {
    throw new GuestUploadError('Misafir oturumu geçersiz. Sayfayı yenileyip tekrar deneyin.', 400, 'invalid_guest_session')
  }

  return createHmac('sha256', encryptionKey())
    .update(`guest-upload-contributor-v1|${eventId}|${guestId.toLowerCase()}`)
    .digest('hex')
}

export function hashGuestUploadIds(value: unknown, eventId: string) {
  if (typeof value !== 'string') {
    throw new GuestUploadError('Misafir oturumu geçersiz. Sayfayı yenileyip tekrar deneyin.', 400, 'invalid_guest_session')
  }
  const guestIds = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()))]
  if (!guestIds.length || guestIds.length > 8) {
    throw new GuestUploadError('Misafir oturumu geçersiz. Sayfayı yenileyip tekrar deneyin.', 400, 'invalid_guest_session')
  }
  return guestIds.map((guestId) => hashGuestUploadId(guestId, eventId))
}

function safeFilenamePart(value: string) {
  const turkishCharacters: Record<string, string> = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  }
  const latin = [...value].map((character) => turkishCharacters[character] ?? character).join('')
  return latin
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'Misafir'
}

function safeExtension(originalName: string, mimeType: string) {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/x-m4v': 'm4v',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-msvideo': 'avi',
    'video/3gpp': '3gp',
    'video/ogg': 'ogg',
  }
  const supplied = originalName.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase()
  return known[mimeType] ?? supplied ?? (mimeType.startsWith('image/') ? 'jpg' : 'mp4')
}

export function createDriveFilename(
  eventDate: string,
  displayName: string,
  originalName: string,
  mimeType: string,
  sequence: number,
) {
  const safeName = displayName === 'Anonim'
    ? 'Anonim'
    : safeFilenamePart(displayName.replace(/\s+/g, '-'))
  return `${eventDate}_${safeName}_${String(sequence).padStart(3, '0')}.${safeExtension(originalName, mimeType)}`
}

export function createDriveDescription(displayName: string, note: string) {
  return `İsim Soyisim: ${displayName}\nNot: ${note || '—'}`
}

function ticketSigningKey() {
  return createHmac('sha256', encryptionKey())
    .update('AniBiriktir guest upload ticket v1')
    .digest()
}

export function signGuestUploadTicket(ticket: GuestUploadTicket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  const signature = createHmac('sha256', ticketSigningKey()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyGuestUploadTicket(value: unknown): GuestUploadTicket {
  if (typeof value !== 'string') {
    throw new GuestUploadError('Yükleme onayı geçersiz veya süresi dolmuş.', 403, 'invalid_upload_ticket')
  }

  const [payload, providedSignature, ...extra] = value.split('.')
  if (!payload || !providedSignature || extra.length) {
    throw new GuestUploadError('Yükleme onayı geçersiz veya süresi dolmuş.', 403, 'invalid_upload_ticket')
  }
  const expectedSignature = createHmac('sha256', ticketSigningKey()).update(payload).digest()
  const receivedSignature = Buffer.from(providedSignature, 'base64url')
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) {
    throw new GuestUploadError('Yükleme onayı geçersiz veya süresi dolmuş.', 403, 'invalid_upload_ticket')
  }

  let ticket: unknown
  try {
    ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new GuestUploadError('Yükleme onayı geçersiz veya süresi dolmuş.', 403, 'invalid_upload_ticket')
  }

  if (
    !ticket ||
    typeof ticket !== 'object' ||
    !('version' in ticket) || ticket.version !== 1 ||
    !('eventId' in ticket) || typeof ticket.eventId !== 'string' ||
    !('eventDate' in ticket) || typeof ticket.eventDate !== 'string' ||
    !('guestHash' in ticket) || typeof ticket.guestHash !== 'string' || !/^[0-9a-f]{64}$/.test(ticket.guestHash) ||
    !('uploadUrl' in ticket) || typeof ticket.uploadUrl !== 'string' ||
    !('fileName' in ticket) || typeof ticket.fileName !== 'string' ||
    !('fileSize' in ticket) || typeof ticket.fileSize !== 'number' ||
    !('mimeType' in ticket) || typeof ticket.mimeType !== 'string' ||
    !('displayName' in ticket) || typeof ticket.displayName !== 'string' ||
    !('note' in ticket) || typeof ticket.note !== 'string' ||
    !('issuedAt' in ticket) || typeof ticket.issuedAt !== 'number' ||
    Date.now() - ticket.issuedAt > 24 * 60 * 60 * 1000 ||
    ticket.issuedAt > Date.now() + 60 * 1000
  ) {
    throw new GuestUploadError('Yükleme onayı geçersiz veya süresi dolmuş.', 403, 'invalid_upload_ticket')
  }

  return ticket as GuestUploadTicket
}

export async function createDriveUploadSession(
  accessToken: string,
  folderId: string,
  ticket: Omit<GuestUploadTicket, 'uploadUrl'>,
  origin: string,
) {
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents,description,createdTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: origin,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': ticket.mimeType,
        'X-Upload-Content-Length': String(ticket.fileSize),
      },
      body: JSON.stringify({
        name: ticket.fileName,
        mimeType: ticket.mimeType,
        parents: [folderId],
        description: createDriveDescription(ticket.displayName, ticket.note),
      }),
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    await parseGoogleJson(response)
    throw new GuestUploadError(`Google Drive yükleme oturumu başlatılamadı (HTTP ${response.status}).`, 502, 'drive_session_failed')
  }

  const sessionUrl = response.headers.get('location')
  if (!sessionUrl) {
    throw new GuestUploadError('Google Drive yükleme oturumu adresi alınamadı.', 502, 'drive_invalid_response')
  }
  const parsedSessionUrl = new URL(sessionUrl)
  if (
    parsedSessionUrl.protocol !== 'https:' ||
    !['www.googleapis.com', 'upload.googleapis.com'].includes(parsedSessionUrl.hostname) ||
    !parsedSessionUrl.pathname.startsWith('/upload/drive/v3/files')
  ) {
    throw new GuestUploadError('Google Drive yükleme adresi güvenli değil.', 502, 'drive_invalid_response')
  }
  return parsedSessionUrl.toString()
}

export async function getDriveFile(accessToken: string, fileId: string, attempt = 0): Promise<DriveFile> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'id,name,mimeType,size,parents,description,createdTime,trashed')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if ((response.status === 404 || response.status >= 500) && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    return getDriveFile(accessToken, fileId, attempt + 1)
  }

  const payload = await parseGoogleJson(response)
  if (!response.ok) {
    throw new GuestUploadError(`Yüklenen dosya Drive’da doğrulanamadı (HTTP ${response.status}).`, 502, 'drive_file_unavailable')
  }
  return payload as DriveFile
}

async function findNotesCsv(accessToken: string, folderId: string) {
  const query = new URL('https://www.googleapis.com/drive/v3/files')
  query.searchParams.set('q', `'${folderId}' in parents and name = 'notlar.csv' and trashed = false`)
  query.searchParams.set('fields', 'files(id,name,mimeType)')
  query.searchParams.set('pageSize', '10')
  const response = await fetch(query, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const payload = await parseGoogleJson(response)
  if (!response.ok) {
    throw new GuestUploadError(`Drive notlar dosyası aranamadı (HTTP ${response.status}).`, 502, 'drive_csv_failed')
  }

  const files = payload.files
  if (!Array.isArray(files)) return null
  return files.find((file): file is DriveFile =>
    Boolean(file && typeof file === 'object' && 'id' in file && typeof file.id === 'string'),
  ) ?? null
}

async function readDriveTextFile(accessToken: string, fileId: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
  )
  if (!response.ok) {
    throw new GuestUploadError(`Drive notlar dosyası okunamadı (HTTP ${response.status}).`, 502, 'drive_csv_failed')
  }
  return response.text()
}

async function createNotesCsv(accessToken: string, folderId: string) {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'notlar.csv',
      mimeType: 'text/csv',
      parents: [folderId],
    }),
    cache: 'no-store',
  })
  const payload = await parseGoogleJson(response)
  if (!response.ok || typeof payload.id !== 'string') {
    throw new GuestUploadError(`Drive notlar dosyası oluşturulamadı (HTTP ${response.status}).`, 502, 'drive_csv_failed')
  }
  return payload.id
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function csvRow(values: string[]) {
  return values.map(csvCell).join(',')
}

async function writeDriveTextFile(accessToken: string, fileId: string, value: string) {
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/csv; charset=UTF-8',
      },
      body: value,
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    await parseGoogleJson(response)
    throw new GuestUploadError(`Drive notlar dosyası güncellenemedi (HTTP ${response.status}).`, 502, 'drive_csv_failed')
  }
}

async function withCsvLock<T>(admin: AdminClient, eventId: string, operation: () => Promise<T>): Promise<T> {
  const lockToken = randomUUID()
  let acquired = false
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await admin.rpc('acquire_event_upload_csv_lock', {
      p_event_id: eventId,
      p_lock_token: lockToken,
      p_lease_seconds: 90,
    })
    if (error) {
      console.error('Drive notlar dosyası kilidi alınamadı:', error)
      throw new GuestUploadError('Notlar dosyası şu anda güncellenemiyor.', 503, 'drive_csv_lock_failed')
    }
    if (data === true) {
      acquired = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (!acquired) {
    throw new GuestUploadError('Notlar dosyası başka bir yükleme tarafından güncelleniyor. Tekrar deneyin.', 503, 'drive_csv_busy')
  }

  try {
    return await operation()
  } finally {
    const { error } = await admin.rpc('release_event_upload_csv_lock', {
      p_event_id: eventId,
      p_lock_token: lockToken,
    })
    if (error) console.error('Drive notlar dosyası kilidi bırakılamadı:', error)
  }
}

export async function appendUploadToNotesCsv(
  admin: AdminClient,
  eventId: string,
  folderId: string,
  accessToken: string,
  file: DriveFile,
  ticket: GuestUploadTicket,
) {
  return withCsvLock(admin, eventId, async () => {
    const existingCsv = await findNotesCsv(accessToken, folderId)
    const csvId = existingCsv?.id ?? await createNotesCsv(accessToken, folderId)
    const currentCsv = existingCsv ? await readDriveTextFile(accessToken, csvId) : ''
    const header = csvRow(['Dosya adı', 'Tür', 'Boyut (bayt)', 'Yüklenme tarihi', 'İsim Soyisim', 'Not'])
    const row = csvRow([
      file.name,
      file.mimeType,
      file.size ?? String(ticket.fileSize),
      file.createdTime ?? new Date(ticket.issuedAt).toISOString(),
      ticket.displayName,
      ticket.note,
    ])

    if (currentCsv.split(/\r?\n/).includes(row)) return
    const prefix = currentCsv.trimEnd()
    const nextCsv = prefix
      ? `${prefix}\r\n${row}\r\n`
      : `${header}\r\n${row}\r\n`
    await writeDriveTextFile(accessToken, csvId, nextCsv)
  })
}

export async function saveUploadMetadata(
  admin: AdminClient,
  eventId: string,
  file: DriveFile,
  ticket: GuestUploadTicket,
) {
  const { error } = await admin.from('uploads_meta').upsert({
    event_id: eventId,
    drive_file_id: file.id,
    guest_hash: ticket.guestHash,
    file_size: Number(file.size),
    mime_type: file.mimeType,
    uploaded_at: file.createdTime ?? new Date().toISOString(),
  }, { onConflict: 'drive_file_id', ignoreDuplicates: true })

  if (error) {
    console.error('Anı yükleme özeti kaydedilemedi:', error)
    throw new GuestUploadError('Dosya yüklendi ancak yükleme kaydı tamamlanamadı; tekrar deneyin.', 503, 'upload_metadata_failed')
  }
}

export type OwnUpload = {
  id: string
  driveFileId: string
  fileSize: number
  mimeType: string
  uploadedAt: string
}

export async function listOwnUploads(admin: AdminClient, eventId: string, guestHashes: string[]): Promise<OwnUpload[]> {
  if (!guestHashes.length || guestHashes.length > 8) {
    throw new GuestUploadError('Misafir oturumu geçersiz. Sayfayı yenileyip tekrar deneyin.', 400, 'invalid_guest_session')
  }
  const { data, error } = await admin
    .from('uploads_meta')
    .select('id, drive_file_id, file_size, mime_type, uploaded_at')
    .eq('event_id', eventId)
    .in('guest_hash', guestHashes)
    .order('uploaded_at', { ascending: false })
    .limit(200)
  if (error) {
    console.error('Misafir yüklemeleri okunamadı:', error)
    throw new GuestUploadError('Yüklemeleriniz şu anda alınamadı.', 503, 'own_uploads_unavailable')
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    driveFileId: row.drive_file_id as string,
    fileSize: Number(row.file_size),
    mimeType: row.mime_type as string,
    uploadedAt: row.uploaded_at as string,
  }))
}

export async function findOwnUpload(admin: AdminClient, eventId: string, guestHashes: string[], uploadId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new GuestUploadError('Yükleme bulunamadı.', 404, 'upload_not_found')
  }
  if (!guestHashes.length || guestHashes.length > 8) {
    throw new GuestUploadError('Misafir oturumu geçersiz. Sayfayı yenileyip tekrar deneyin.', 400, 'invalid_guest_session')
  }
  const { data, error } = await admin
    .from('uploads_meta')
    .select('id, drive_file_id')
    .eq('id', uploadId)
    .eq('event_id', eventId)
    .in('guest_hash', guestHashes)
    .maybeSingle()
  if (error) {
    console.error('Misafir yüklemesi okunamadı:', error)
    throw new GuestUploadError('Yükleme şu anda okunamadı.', 503, 'own_uploads_unavailable')
  }
  if (!data) throw new GuestUploadError('Yükleme bulunamadı.', 404, 'upload_not_found')
  return { id: data.id as string, driveFileId: data.drive_file_id as string }
}

export async function getDriveFileDisplay(accessToken: string, fileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'id,name,trashed,thumbnailLink')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (response.status === 404) return null
  if (!response.ok) return undefined
  return await response.json() as { name?: string, trashed?: boolean, thumbnailLink?: string }
}

export async function fetchDriveThumbnail(accessToken: string, fileId: string) {
  const file = await getDriveFileDisplay(accessToken, fileId)
  if (!file?.thumbnailLink || file.trashed) return null
  const link = new URL(file.thumbnailLink)
  if (link.protocol !== 'https:') return null
  link.searchParams.set('sz', 's400')
  const response = await fetch(link, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) return null
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') || 'image/jpeg',
  }
}

export async function trashDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
      cache: 'no-store',
    },
  )
  if (!response.ok && response.status !== 404) {
    throw new GuestUploadError(`Dosya Drive’dan silinemedi (HTTP ${response.status}).`, 502, 'drive_delete_failed')
  }
}

export async function removeUploadFromNotesCsv(
  admin: AdminClient,
  eventId: string,
  folderId: string,
  accessToken: string,
  fileName: string,
) {
  return withCsvLock(admin, eventId, async () => {
    const existingCsv = await findNotesCsv(accessToken, folderId)
    if (!existingCsv) return
    const currentCsv = await readDriveTextFile(accessToken, existingCsv.id)
    const prefix = `${csvCell(fileName)},`
    const lines = currentCsv.split(/\r?\n/)
    const remaining = lines.filter((line) => !line.startsWith(prefix))
    if (remaining.length === lines.length) return
    const next = remaining.join('\r\n').trimEnd()
    await writeDriveTextFile(accessToken, existingCsv.id, next ? `${next}\r\n` : '')
  })
}
