import { NextResponse } from 'next/server'
import {
  enforceGuestUploadRateLimit,
  fetchDriveThumbnail,
  findOwnUpload,
  findUploadEvent,
  getDriveFileDisplay,
  getGuestUploadContext,
  hashGuestUploadIds,
  removeUploadFromNotesCsv,
  trashDriveFile,
  uploadFailureResponse,
} from '@/lib/guest-upload'
import { getPublicAppUrl } from '@/lib/site-url'
import { createAdminClient } from '@/lib/db/admin'

export const runtime = 'nodejs'

type RouteProps = {
  params: Promise<{ slug: string, id: string }>
}

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const { slug, id } = await params
    const admin = createAdminClient()
    const event = await findUploadEvent(admin, slug)
    const guestHashes = hashGuestUploadIds(
      request.headers.get('x-guest-ids') ?? request.headers.get('x-guest-id'),
      event.id,
    )
    const upload = await findOwnUpload(admin, event.id, guestHashes, id)

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    const { accessToken } = await getGuestUploadContext(admin, event, origin)
    const thumbnail = await fetchDriveThumbnail(accessToken, upload.driveFileId)
    if (!thumbnail) return new NextResponse(null, { status: 404 })

    return new NextResponse(thumbnail.body, {
      headers: { 'Content-Type': thumbnail.contentType, 'Cache-Control': 'private, max-age=300' },
    })
  } catch (error) {
    return uploadFailureResponse(error, 'Küçük resim alınamadı')
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  try {
    const { slug, id } = await params
    const admin = createAdminClient()
    const event = await findUploadEvent(admin, slug)
    const guestHashes = hashGuestUploadIds(
      request.headers.get('x-guest-ids') ?? request.headers.get('x-guest-id'),
      event.id,
    )
    await enforceGuestUploadRateLimit(admin, request, event.id)
    const upload = await findOwnUpload(admin, event.id, guestHashes, id)

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    const { connection, accessToken } = await getGuestUploadContext(admin, event, origin)
    const file = await getDriveFileDisplay(accessToken, upload.driveFileId)
    if (file === undefined) {
      return NextResponse.json({ error: 'Dosya şu anda silinemedi. Tekrar deneyin.', code: 'drive_delete_failed' }, { status: 502 })
    }

    if (file && !file.trashed) {
      await trashDriveFile(accessToken, upload.driveFileId)
      if (file.name) {
        try {
          await removeUploadFromNotesCsv(admin, event.id, connection.drive_folder_id, accessToken, file.name)
        } catch (csvError) {
          console.error('Silinen yükleme notlar dosyasından çıkarılamadı:', csvError)
        }
      }
    }

    const { error } = await admin.from('uploads_meta').delete().eq('id', upload.id).eq('event_id', event.id)
    if (error) {
      console.error('Yükleme kaydı silinemedi:', error)
      return NextResponse.json({ error: 'Yükleme kaydı silinemedi. Tekrar deneyin.', code: 'upload_delete_failed' }, { status: 503 })
    }

    return NextResponse.json({ deleted: true })
  } catch (error) {
    return uploadFailureResponse(error, 'Yükleme silinemedi')
  }
}
