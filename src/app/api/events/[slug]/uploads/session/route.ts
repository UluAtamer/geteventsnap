import { NextResponse } from 'next/server'
import { getPublicAppUrl } from '@/lib/site-url'
import { getEventUploadWindow } from '@/lib/event-upload-window'
import {
  createDriveFilename,
  createDriveUploadSession,
  enforceGuestUploadRateLimit,
  findUploadEvent,
  getGuestUploadContext,
  getGuestUploadLimits,
  hashGuestUploadId,
  getText,
  GuestUploadError,
  readUploadJson,
  signGuestUploadTicket,
  uploadFailureResponse,
  validateGuestUploadWindow,
  type GuestUploadTicket,
} from '@/lib/guest-upload'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type RouteProps = {
  params: Promise<{ slug: string }>
}

function resolveMimeType(value: unknown, fileName: string) {
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    gif: 'image/gif',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    '3gp': 'video/3gpp',
    ogg: 'video/ogg',
  }
  const allowedMimeTypes = new Set(Object.values(byExtension))
  const suppliedMimeType = typeof value === 'string' ? value.toLowerCase() : ''
  if (allowedMimeTypes.has(suppliedMimeType)) return suppliedMimeType

  const extension = fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase()
  return extension ? byExtension[extension] ?? '' : ''
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { slug } = await params
    const body = await readUploadJson(request)
    const originalName = getText(body.fileName, 255)
    const mimeType = resolveMimeType(body.mimeType, originalName)
    const fileSize = body.fileSize
    const sequence = body.sequence
    const anonymous = body.anonymous === true

    if (!originalName || !mimeType || !Number.isSafeInteger(fileSize) || (fileSize as number) <= 0) {
      throw new GuestUploadError('Dosya adı, türü veya boyutu geçersiz.', 400, 'invalid_file')
    }
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 1 || (sequence as number) > 999_999) {
      throw new GuestUploadError('Dosya sırası geçersiz.', 400, 'invalid_file')
    }

    const isPhoto = mimeType.startsWith('image/')
    const isVideo = mimeType.startsWith('video/')
    if (!isPhoto && !isVideo) {
      throw new GuestUploadError('Yalnızca fotoğraf ve video yüklenebilir.', 415, 'unsupported_file_type')
    }
    const limits = getGuestUploadLimits()
    if (isPhoto && (fileSize as number) > limits.photoBytes) {
      throw new GuestUploadError('Fotoğraf boyutu izin verilen sınırı aşıyor.', 413, 'file_too_large')
    }
    if (isVideo && (fileSize as number) > limits.videoBytes) {
      throw new GuestUploadError('Video boyutu izin verilen sınırı aşıyor.', 413, 'file_too_large')
    }

    let displayName = 'Anonim'
    if (!anonymous) {
      const name = getText(body.name, 1_000)
      const surname = getText(body.surname, 1_000)
      if (!name || !surname || name.length > 60 || surname.length > 60) {
        throw new GuestUploadError('İsim ve soyisim alanları 1–60 karakter olmalıdır.', 400, 'invalid_guest_name')
      }
      displayName = `${name} ${surname}`
    }

    const rawNote = typeof body.note === 'string' ? body.note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : ''
    if (rawNote.length > 300) {
      throw new GuestUploadError('Not en fazla 300 karakter olabilir.', 400, 'note_too_long')
    }
    const note = getText(rawNote, 300)

    const admin = createAdminClient()
    const event = await findUploadEvent(admin, slug)
    const guestHash = hashGuestUploadId(body.guestId, event.id)
    const window = getEventUploadWindow(event.event_date)
    validateGuestUploadWindow(event.event_date)
    await enforceGuestUploadRateLimit(admin, request, event.id)

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    const { connection, accessToken } = await getGuestUploadContext(admin, event, origin)
    const fileName = createDriveFilename(
      event.event_date,
      displayName,
      originalName,
      mimeType,
      sequence as number,
    )
    const ticket: Omit<GuestUploadTicket, 'uploadUrl'> = {
      version: 1,
      eventId: event.id,
      eventDate: event.event_date,
      guestHash,
      fileName,
      fileSize: fileSize as number,
      mimeType,
      displayName,
      note,
      issuedAt: Date.now(),
    }

    const uploadUrl = await createDriveUploadSession(
      accessToken,
      connection.drive_folder_id,
      ticket,
      origin,
    )
    const signedTicket: GuestUploadTicket = { ...ticket, uploadUrl }

    return NextResponse.json({
      ticket: signGuestUploadTicket(signedTicket),
      fileName,
      mimeType,
      uploadWindow: {
        firstUploadDate: window.firstUploadDate,
        lastUploadDate: window.lastUploadDate,
      },
    })
  } catch (error) {
    return uploadFailureResponse(error, 'Google Drive yükleme oturumu başlatılamadı')
  }
}
