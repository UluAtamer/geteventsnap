import { NextResponse } from 'next/server'
import {
  enforceGuestUploadRateLimit,
  findUploadEvent,
  getDriveFileDisplay,
  getGuestUploadContext,
  hashGuestUploadIds,
  listOwnUploads,
  uploadFailureResponse,
} from '@/lib/guest-upload'
import { getPublicAppUrl } from '@/lib/site-url'
import { createAdminClient } from '@/lib/db/admin'

export const runtime = 'nodejs'

type RouteProps = {
  params: Promise<{ slug: string }>
}

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const { slug } = await params
    const admin = createAdminClient()
    const event = await findUploadEvent(admin, slug)
    const guestHashes = hashGuestUploadIds(
      request.headers.get('x-guest-ids') ?? request.headers.get('x-guest-id'),
      event.id,
    )
    await enforceGuestUploadRateLimit(admin, request, event.id)

    const uploads = await listOwnUploads(admin, event.id, guestHashes)
    if (!uploads.length) return NextResponse.json({ uploads: [] })

    const origin = getPublicAppUrl('/', new URL(request.url)).origin
    const { accessToken } = await getGuestUploadContext(admin, event, origin)
    const items = await Promise.all(uploads.map(async (upload) => {
      const file = await getDriveFileDisplay(accessToken, upload.driveFileId)
      if (file === null || file?.trashed) return null
      return {
        id: upload.id,
        name: file?.name ?? 'Dosya',
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        uploadedAt: upload.uploadedAt,
      }
    }))

    return NextResponse.json({ uploads: items.filter((item) => item !== null) })
  } catch (error) {
    return uploadFailureResponse(error, 'Misafir yüklemeleri listelenemedi')
  }
}
