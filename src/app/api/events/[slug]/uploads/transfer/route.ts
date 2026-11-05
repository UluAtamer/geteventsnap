import { NextResponse } from 'next/server'
import { getPublicAppUrl } from '@/lib/site-url'
import {
  GuestUploadError,
  uploadFailureResponse,
  verifyGuestUploadTicket,
} from '@/lib/guest-upload'

export const runtime = 'nodejs'

const MAX_CHUNK_BYTES = 8 * 1024 * 1024

type RouteProps = {
  params: Promise<{ slug: string }>
}

async function readLimitedBody(request: Request, maximumBytes: number) {
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel()
        throw new GuestUploadError('Yükleme parçası izin verilen boyutu aşıyor.', 413, 'chunk_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function validateUploadUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new GuestUploadError('Google Drive yükleme oturumu geçersiz.', 400, 'invalid_upload_session')
  }

  if (
    url.protocol !== 'https:' ||
    !['www.googleapis.com', 'upload.googleapis.com'].includes(url.hostname) ||
    !url.pathname.startsWith('/upload/drive/v3/files')
  ) {
    throw new GuestUploadError('Google Drive yükleme oturumu geçersiz.', 400, 'invalid_upload_session')
  }
  return url
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { slug } = await params
    const ticket = verifyGuestUploadTicket(request.headers.get('x-upload-ticket'))
    const uploadUrl = validateUploadUrl(ticket.uploadUrl)
    const operation = request.headers.get('x-upload-operation')
    const contentRange = request.headers.get('content-range') ?? ''
    const isStatusCheck = operation === 'status' && contentRange === `bytes */${ticket.fileSize}`
    const chunkMatch = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
    const isChunk = operation === 'chunk' &&
      chunkMatch !== null &&
      Number(chunkMatch[3]) === ticket.fileSize &&
      Number(chunkMatch[1]) <= Number(chunkMatch[2]) &&
      Number(chunkMatch[2]) < ticket.fileSize &&
      Number(chunkMatch[2]) - Number(chunkMatch[1]) + 1 <= MAX_CHUNK_BYTES

    if (ticket.eventId.length === 0 || !slug || (!isStatusCheck && !isChunk)) {
      throw new GuestUploadError('Yükleme isteği geçersiz.', 400, 'invalid_upload_request')
    }

    const chunk = await readLimitedBody(request, isStatusCheck ? 0 : MAX_CHUNK_BYTES)
    if (isChunk && chunk.byteLength !== Number(chunkMatch?.[2]) - Number(chunkMatch?.[1]) + 1) {
      throw new GuestUploadError('Yükleme parçasının boyutu uyuşmuyor.', 400, 'invalid_upload_chunk')
    }

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    let driveResponse: Response
    try {
      driveResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': contentRange,
          ...(isChunk ? { 'Content-Type': ticket.mimeType } : {}),
          Origin: origin,
        },
        ...(isChunk ? { body: chunk } : {}),
        cache: 'no-store',
        redirect: 'manual',
      })
    } catch (error) {
      console.error('Google Drive yükleme parçası iletilemedi:', error)
      throw new GuestUploadError('Google Drive bağlantısı kurulamadı. Lütfen tekrar deneyin.', 502, 'drive_transfer_failed')
    }

    if (driveResponse.status === 308) {
      return NextResponse.json({
        driveStatus: 308,
        range: driveResponse.headers.get('range'),
      })
    }

    if (driveResponse.status === 200 || driveResponse.status === 201) {
      let file: unknown
      try {
        file = await driveResponse.json()
      } catch {
        throw new GuestUploadError('Google Drive yükleme yanıtı okunamadı.', 502, 'drive_invalid_response')
      }
      if (!file || typeof file !== 'object' || !('id' in file) || typeof file.id !== 'string') {
        throw new GuestUploadError('Google Drive dosya numarasını döndürmedi.', 502, 'drive_invalid_response')
      }
      return NextResponse.json({ driveStatus: driveResponse.status, fileId: file.id })
    }

    return NextResponse.json({ driveStatus: driveResponse.status })
  } catch (error) {
    return uploadFailureResponse(error, 'Google Drive’a yükleme parçası aktarılamadı')
  }
}
