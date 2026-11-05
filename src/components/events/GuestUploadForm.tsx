'use client'

import { useEffect, useRef, useState } from 'react'
import {
  type UploadWindowState,
} from '@/lib/event-upload-window'
import styles from './GuestUploadForm.module.css'

type GuestUploadLimits = {
  photoBytes: number
  videoBytes: number
}

type UploadItem = {
  id: string
  file: File
  status: 'ready' | 'uploading' | 'done' | 'failed'
  progress: number
  message?: string
  session?: UploadSession
  uploadedFileId?: string
}

type Props = {
  slug: string
  initialWindowState: UploadWindowState
  limits: GuestUploadLimits
}

type UploadSession = {
  ticket: string
  fileName: string
  mimeType: string
}

const CHUNK_SIZE = 8 * 1024 * 1024
const GUEST_ID_STORAGE_KEY = 'anibirik-guest-id-v1'
const GUEST_ID_COOKIE_KEY = 'anibirik_guest_id_v1'
const GUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_GUEST_IDS = 8

function createGuestId() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function getGuestIds() {
  try {
    const cookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${GUEST_ID_COOKIE_KEY}=`))
      ?.slice(GUEST_ID_COOKIE_KEY.length + 1)
    let guestIds: string[] = []
    if (cookie) {
      try {
        const decoded = decodeURIComponent(cookie)
        const parsed: unknown = JSON.parse(decoded)
        if (Array.isArray(parsed)) {
          guestIds = parsed.filter((value): value is string => typeof value === 'string' && GUEST_ID_PATTERN.test(value))
        } else if (GUEST_ID_PATTERN.test(decoded)) {
          guestIds = [decoded]
        }
      } catch {
        if (GUEST_ID_PATTERN.test(cookie)) guestIds = [cookie]
      }
    }

    const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY)
    if (existing && GUEST_ID_PATTERN.test(existing)) {
      guestIds.push(existing.toLowerCase())
    }

    guestIds = [...new Set(guestIds.map((value) => value.toLowerCase()))].slice(0, MAX_GUEST_IDS)
    if (!guestIds.length) guestIds.push(createGuestId())

    if (!existing || !GUEST_ID_PATTERN.test(existing)) {
      window.localStorage.setItem(GUEST_ID_STORAGE_KEY, guestIds[0])
    }
    persistGuestIdsCookie(guestIds)
    return guestIds
  } catch (error) {
    console.error('Anonim misafir sayacı için tarayıcı kimliği oluşturulamadı:', error)
    throw new Error('Anonim yükleme kimliği kaydedilemedi. Tarayıcı ayarlarınızda bu site için depolamaya izin verip tekrar deneyin.')
  }
}

function getGuestId() {
  return getGuestIds()[0]
}

function persistGuestIdsCookie(guestIds: string[]) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${GUEST_ID_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(guestIds))}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`
}

function readableSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function rangeOffset(range: string | null) {
  const match = range?.match(/bytes=0-(\d+)/i)
  return match ? Number(match[1]) + 1 : 0
}

type TransferResponse = {
  driveStatus?: number
  range?: string | null
  fileId?: string
  error?: string
}

async function transferUpload(
  slug: string,
  ticket: string,
  operation: 'chunk' | 'status',
  contentRange: string,
  body?: Blob,
  mimeType?: string,
) {
  const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/transfer`, {
    method: 'POST',
    headers: {
      'X-Upload-Ticket': ticket,
      'X-Upload-Operation': operation,
      'Content-Range': contentRange,
      ...(mimeType ? { 'Content-Type': mimeType } : {}),
    },
    ...(body ? { body } : {}),
  })
  const result = await response.json() as TransferResponse
  if (!response.ok) {
    throw new Error(result.error || 'Google Drive yükleme isteği tamamlanamadı.')
  }
  return result
}

async function checkResumableUpload(slug: string, ticket: string, totalBytes: number) {
  const result = await transferUpload(slug, ticket, 'status', `bytes */${totalBytes}`)
  if (result.driveStatus === 308) {
    return { offset: rangeOffset(result.range ?? null), fileId: null }
  }
  if ((result.driveStatus === 200 || result.driveStatus === 201) && result.fileId) {
    return { offset: totalBytes, fileId: result.fileId }
  }
  throw new Error('Yükleme oturumu yanıt vermiyor. Tekrar deneyin.')
}

async function uploadResumable(
  slug: string,
  ticket: string,
  file: File,
  mimeType: string,
  onProgress: (percentage: number) => void,
) {
  let offset = 0
  let failures = 0

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size) - 1
    const chunk = file.slice(offset, end + 1)
    let result: TransferResponse

    try {
      result = await transferUpload(
        slug,
        ticket,
        'chunk',
        `bytes ${offset}-${end}/${file.size}`,
        chunk,
        mimeType,
      )
    } catch {
      failures += 1
      if (failures > 3) {
        throw new Error('Bağlantı kesildi. Aynı dosyada tekrar deneyebilirsiniz.')
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** failures))
      const status = await checkResumableUpload(slug, ticket, file.size)
      if (status.fileId) return status.fileId
      offset = status.offset
      onProgress(Math.floor((offset / file.size) * 100))
      continue
    }

    if (result.driveStatus === 308) {
      const nextOffset = rangeOffset(result.range ?? null)
      if (nextOffset <= offset) {
        failures += 1
        if (failures > 3) {
          throw new Error('Google Drive yüklemeyi ilerletemedi. Tekrar deneyin.')
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** failures))
        const status = await checkResumableUpload(slug, ticket, file.size)
        if (status.fileId) return status.fileId
        offset = status.offset
        continue
      }
      offset = nextOffset
      failures = 0
      onProgress(Math.floor((offset / file.size) * 100))
      continue
    }

    if ((result.driveStatus === 200 || result.driveStatus === 201) && result.fileId) {
      onProgress(100)
      return result.fileId
    }

    if (result.driveStatus !== undefined && result.driveStatus >= 500 && failures < 3) {
      failures += 1
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** failures))
      const status = await checkResumableUpload(slug, ticket, file.size)
      if (status.fileId) return status.fileId
      offset = status.offset
      continue
    }
    if (result.driveStatus === 401 || result.driveStatus === 403) {
      throw new Error('Google Drive yükleme izni reddetti. Etkinlik yöneticisi Drive bağlantısını kontrol etmeli.')
    }
    throw new Error('Dosya Google Drive’a yüklenemedi. Tekrar deneyin.')
  }

  const status = await checkResumableUpload(slug, ticket, file.size)
  if (status.fileId) return status.fileId
  throw new Error('Dosya yüklemesi tamamlanamadı. Tekrar deneyin.')
}

type OwnUploadItem = {
  id: string
  name: string
  mimeType: string
  fileSize: number
  uploadedAt: string
}

function OwnThumbnail({ slug, id }: { slug: string, id: string }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let objectUrl = ''
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/mine/${id}`, {
          headers: { 'X-Guest-Id': getGuestId() },
        })
        if (!response.ok || cancelled) return
        objectUrl = URL.createObjectURL(await response.blob())
        if (cancelled) URL.revokeObjectURL(objectUrl)
        else setSrc(objectUrl)
      } catch {
        // Küçük resim isteğe bağlıdır.
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [slug, id])

  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={styles.ownThumb} /> : <span className={styles.ownThumb} aria-hidden="true" />
}

function OwnUploads({ slug, refreshKey }: { slug: string, refreshKey: number }) {
  const [items, setItems] = useState<OwnUploadItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [manualRefreshKey, setManualRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void (async () => {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/mine`, {
          headers: { 'X-Guest-Ids': getGuestIds().join(',') },
          cache: 'no-store',
        })
        const result = await response.json() as { uploads?: OwnUploadItem[], error?: string }
        if (cancelled) return
        if (!response.ok) {
          setMessage(result.error || 'Yüklemeleriniz alınamadı.')
        } else {
          setItems(result.uploads ?? [])
          setMessage('')
        }
      } catch {
        if (!cancelled) setMessage('Yüklemeleriniz alınamadı.')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [slug, refreshKey, manualRefreshKey])

  async function remove(item: OwnUploadItem) {
    if (!window.confirm(`“${item.name}” silinsin mi? Bu işlem geri alınamaz.`)) return
    setBusyId(item.id)
    setMessage('')
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/mine/${item.id}`, {
        method: 'DELETE',
        headers: { 'X-Guest-Ids': getGuestIds().join(',') },
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Silinemedi.')
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Silinemedi.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className={styles.ownUploads} aria-labelledby="own-uploads-heading">
      <div className={styles.ownUploadsHeader}>
        <h3 id="own-uploads-heading">Yüklediklerim</h3>
        <button type="button" onClick={() => setManualRefreshKey((current) => current + 1)} disabled={!loaded || Boolean(busyId)}>
          Yenile
        </button>
      </div>
      <p className={styles.limits}>Bu tarayıcıdan eklediğiniz dosyaları görebilir ve silebilirsiniz.</p>
      {message && <p className={styles.formMessage} role="alert">{message}</p>}
      {!loaded && <p className={styles.limits} role="status">Yüklemeleriniz alınıyor…</p>}
      {loaded && !message && items.length === 0 && (
        <p className={styles.limits} role="status">
          Bu tarayıcı kimliğiyle yüklenmiş fotoğraf bulunamadı. Yüklemeyi yaptığınız etkinlik bağlantısını ve tarayıcıyı kullandığınızdan emin olun.
        </p>
      )}
      <ul className={styles.fileList}>
        {items.map((item) => (
          <li key={item.id} className={styles.ownItem}>
            <OwnThumbnail slug={slug} id={item.id} />
            <div className={styles.fileDetails}>
              <strong>{item.name}</strong>
              <span>{readableSize(item.fileSize)} · {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' }).format(new Date(item.uploadedAt))}</span>
            </div>
            <button type="button" onClick={() => void remove(item)} disabled={busyId === item.id}>
              {busyId === item.id ? 'Siliniyor…' : 'Sil'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
export default function GuestUploadForm({ slug, initialWindowState, limits }: Props) {
  const [windowState, setWindowState] = useState<UploadWindowState>(initialWindowState)
  const [anonymous, setAnonymous] = useState(true)
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<UploadItem[]>([])
  const [working, setWorking] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const refreshWindow = async () => {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/status`, { cache: 'no-store' })
        const data = await response.json()
        if (active && ['open', 'closed', 'not_started'].includes(data.state)) setWindowState(data.state)
      } catch { /* The upload API still enforces the window. */ }
    }
    const timer = window.setInterval(refreshWindow, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [slug])

  function addFiles(selected: FileList | null) {
    if (!selected?.length) return
    const newFiles: UploadItem[] = Array.from(selected).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      status: 'ready',
      progress: 0,
    }))
    setFiles((current) => [...current, ...newFiles])
    setFormMessage('')
  }

  function updateFile(id: string, changes: Partial<UploadItem>) {
    setFiles((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))
  }

  async function uploadFile(item: UploadItem, sequence: number) {
    updateFile(item.id, { status: 'uploading', progress: 0, message: undefined })
    let session = item.session
    if (!session) {
      const sessionResponse = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: item.file.name,
          mimeType: item.file.type,
          fileSize: item.file.size,
          sequence,
          guestId: getGuestId(),
          anonymous,
          name,
          surname,
          note,
        }),
      })
      const sessionResult = await sessionResponse.json() as Partial<UploadSession> & { error?: string }
      if (!sessionResponse.ok) {
        throw new Error(sessionResult.error || 'Yükleme başlatılamadı.')
      }
      if (!sessionResult.ticket || !sessionResult.fileName || !sessionResult.mimeType) {
        throw new Error('Yükleme oturum bilgileri eksik.')
      }
      session = sessionResult as UploadSession
      updateFile(item.id, { session })
    }

    let fileId = item.uploadedFileId
    if (!fileId) {
      try {
        fileId = await uploadResumable(slug, session.ticket, item.file, session.mimeType, (progress) => {
          updateFile(item.id, { progress })
        })
        updateFile(item.id, { uploadedFileId: fileId })
      } catch (error) {
        if (error instanceof Error && error.message.includes('oturum yanıt vermiyor')) {
          updateFile(item.id, { session: undefined, uploadedFileId: undefined })
        }
        throw error
      }
    }

    const completeResponse = await fetch(`/api/events/${encodeURIComponent(slug)}/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: session.ticket, fileId }),
    })
    const completion = await completeResponse.json() as { error?: string, warning?: string }
    if (!completeResponse.ok) {
      throw new Error(completion.error || 'Yükleme kaydı tamamlanamadı.')
    }

    updateFile(item.id, {
      status: 'done',
      progress: 100,
      message: completion.warning === 'notes_csv_update_failed'
        ? `${session.fileName} · not listesi güncellenemedi`
        : session.fileName,
      session: undefined,
      uploadedFileId: undefined,
    })
  }

  async function uploadItems(items: UploadItem[]) {
    if (working || !items.length) return
    setWorking(true)
    setFormMessage('')
    let completed = 0
    let failed = 0
    try {
      for (const item of items) {
        const index = files.findIndex((file) => file.id === item.id)
        try {
          await uploadFile(item, Math.max(index, 0) + 1)
          completed += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Yükleme başarısız oldu.'
          updateFile(item.id, { status: 'failed', message })
          failed += 1
        }
      }
    } finally {
      setWorking(false)
    }
    if (failed) {
      setFormMessage(`${completed} dosya yüklendi, ${failed} dosya için tekrar deneyebilirsiniz.`)
    } else if (completed) {
      setFormMessage(`${completed} dosya etkinlik sahibinin Drive’ına yüklendi.`)
    }
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id))
  }

  const waitingForStart = windowState === 'not_started'
  const windowClosed = windowState === 'closed'
  const canUpload = windowState === 'open'
  const doneCount = files.filter((item) => item.status === 'done').length

  return (
    <section className={styles.panel} aria-labelledby="upload-heading">
      <div className={styles.heading}>
        <span aria-hidden="true">♡</span>
        <div>
          <p className={styles.eyebrow}>ANILARINIZI PAYLAŞIN</p>
          <h2 id="upload-heading">Anı Yükle</h2>
        </div>
      </div>


      {waitingForStart && (
        <p className={styles.notice} role="status">
          Yükleme henüz başlamadı. Etkinlik günü saat 00.00’da açılacak.
        </p>
      )}
      {windowClosed && (
        <p className={styles.notice} role="status">
          Yükleme süresi doldu. Anılar etkinlik gününden sonraki 7 gün boyunca toplanır.
        </p>
      )}

      <div className={styles.inputs}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
            disabled={!canUpload || working}
          />
          Anonim ekle
        </label>

        {!anonymous && (
          <div className={styles.nameFields}>
            <label>
              İsim
              <input
                autoComplete="given-name"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canUpload || working}
                placeholder="Adınız"
              />
            </label>
            <label>
              Soyisim
              <input
                autoComplete="family-name"
                maxLength={60}
                value={surname}
                onChange={(event) => setSurname(event.target.value)}
                disabled={!canUpload || working}
                placeholder="Soyadınız"
              />
            </label>
          </div>
        )}

        <label className={styles.noteLabel}>
          Not <span>İsteğe bağlı · {note.length}/300</span>
          <textarea
            maxLength={300}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={!canUpload || working}
            placeholder="Bu fotoğrafla ilgili kısa bir not yazın"
          />
        </label>
      </div>

      <input
        ref={fileInput}
        className={styles.hiddenInput}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={cameraInput}
        className={styles.hiddenInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div className={styles.fileActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => fileInput.current?.click()}
          disabled={!canUpload || working}
        >
          Fotoğraf veya video seç
        </button>
        <button
          type="button"
          className={styles.cameraButton}
          onClick={() => cameraInput.current?.click()}
          disabled={!canUpload || working}
        >
          Kamerayla çek
        </button>
      </div>
      <p className={styles.limits}>
        Fotoğraf en fazla {readableSize(limits.photoBytes)}, video en fazla {readableSize(limits.videoBytes)}.
        Dosyalar doğrudan etkinlik sahibinin Google Drive’ına yüklenir.
      </p>

      {files.length > 0 && (
        <ul className={styles.fileList} aria-label="Seçilen dosyalar">
          {files.map((item) => (
            <li key={item.id} className={styles.fileItem}>
              <div className={styles.fileDetails}>
                <strong>{item.file.name}</strong>
                <span>{readableSize(item.file.size)}{item.message ? ` · ${item.message}` : ''}</span>
              </div>
              {item.status === 'uploading' && (
                <progress className={styles.progress} value={item.progress} max={100}>
                  {item.progress}%
                </progress>
              )}
              {item.status === 'done' && <span className={styles.success}>Yüklendi</span>}
              {item.status === 'failed' && (
                <div className={styles.failed}>
                  <span role="alert">{item.message}</span>
                  <button
                    type="button"
                    onClick={() => void uploadItems([item])}
                    disabled={working || !canUpload}
                  >
                    Tekrar dene
                  </button>
                </div>
              )}
              {item.status === 'ready' && (
                <button type="button" onClick={() => removeFile(item.id)} disabled={working}>
                  Kaldır
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {formMessage && <p className={styles.formMessage} role="status">{formMessage}</p>}
      <button
        type="button"
        className={styles.uploadButton}
        onClick={() => void uploadItems(files.filter((item) => item.status === 'ready' || item.status === 'failed'))}
        disabled={!canUpload || working || files.every((item) => item.status === 'done') || files.length === 0 || (!anonymous && (!name.trim() || !surname.trim()))}
      >
        {working ? 'Yükleniyor…' : 'Seçilenleri yükle'}
      </button>
      <OwnUploads slug={slug} refreshKey={doneCount} />
    </section>
  )
}
