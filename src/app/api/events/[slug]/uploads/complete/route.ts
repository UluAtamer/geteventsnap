import { NextResponse } from 'next/server'
import { getPublicAppUrl } from '@/lib/site-url'
import {
  appendUploadToNotesCsv,
  createDriveDescription,
  enforceGuestUploadRateLimit,
  findUploadEvent,
  getDriveFile,
  getGuestUploadContext,
  GuestUploadError,
  readUploadJson,
  saveUploadMetadata,
  uploadFailureResponse,
  verifyGuestUploadTicket,
} from '@/lib/guest-upload'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type RouteProps = {
  params: Promise<{ slug: string }>
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { slug } = await params
    const body = await readUploadJson(request, 4_000)
    const ticket = verifyGuestUploadTicket(body.ticket)
    const fileId = typeof body.fileId === 'string' ? body.fileId : ''
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) {
      throw new GuestUploadError('Google Drive dosya numarası geçersiz.', 400, 'invalid_file')
    }

    const admin = createAdminClient()
    const event = await findUploadEvent(admin, slug)
    if (event.id !== ticket.eventId || event.event_date !== ticket.eventDate) {
      throw new GuestUploadError('Yükleme onayı bu etkinliğe ait değil.', 403, 'invalid_upload_ticket')
    }
    await enforceGuestUploadRateLimit(admin, request, event.id)

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    const { connection, accessToken } = await getGuestUploadContext(admin, event, origin)
    const file = await getDriveFile(accessToken, fileId)
    if (
      file.trashed ||
      !file.parents?.includes(connection.drive_folder_id) ||
      file.name !== ticket.fileName ||
      file.mimeType !== ticket.mimeType ||
      Number(file.size) !== ticket.fileSize ||
      file.description !== createDriveDescription(ticket.displayName, ticket.note)
    ) {
      throw new GuestUploadError('Yüklenen dosya bu etkinlik için doğrulanamadı.', 400, 'file_verification_failed')
    }

    await saveUploadMetadata(admin, event.id, file, ticket)
    let notesUpdated = true
    try {
      await appendUploadToNotesCsv(
        admin,
        event.id,
        connection.drive_folder_id,
        accessToken,
        file,
        ticket,
      )
    } catch (error) {
      notesUpdated = false
      console.error('Drive yüklemesi kaydedildi ancak notlar CSV dosyası güncellenemedi:', error)
    }

    return NextResponse.json({
      uploaded: true,
      fileName: file.name,
      ...(notesUpdated ? {} : { warning: 'notes_csv_update_failed' }),
    })
  } catch (error) {
    return uploadFailureResponse(error, 'Drive yüklemesi doğrulanamadı')
  }
}
