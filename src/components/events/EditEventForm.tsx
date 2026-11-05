'use client'

import { useEffect, useState, useTransition, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { updateOwnedEvent } from '@/app/dashboard/actions'
import { createClient } from '@/lib/db/client'
import styles from '@/app/dashboard/dashboard.module.css'

type Props = {
  eventId: string
  eventDate: string
  eventTime: string | null
  eventAddress: string | null
  welcomeMessage: string
  coverImageUrl: string | null
}

const MAX_COVER_SIZE = 5 * 1024 * 1024
const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const sampleCovers = [
  { src: '/covers/dugun.svg', label: 'Romantik bahçe' },
  { src: '/covers/arkadas.svg', label: 'Dostlarla buluşma' },
  { src: '/covers/parti.svg', label: 'Işıl ışıl parti' },
  { src: '/covers/diger.svg', label: 'Bahçe sofrası' },
]

export default function EditEventForm({
  eventId,
  eventDate,
  eventTime,
  eventAddress,
  welcomeMessage,
  coverImageUrl,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedCover, setSelectedCover] = useState(coverImageUrl ?? '/covers/diger.svg')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview(selectedCover)
      return
    }
    const previewUrl = URL.createObjectURL(coverFile)
    setCoverPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [coverFile, selectedCover])

  function chooseCoverFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    setMessage('')
    setSaved(false)
    if (!file) return
    if (!ALLOWED_COVER_TYPES.includes(file.type)) {
      setCoverFile(null)
      setMessage('Lütfen JPEG, PNG veya WebP biçiminde bir fotoğraf seçin.')
      return
    }
    if (file.size > MAX_COVER_SIZE) {
      setCoverFile(null)
      setMessage('Arka plan fotoğrafı en fazla 5 MB olabilir.')
      return
    }
    setCoverFile(file)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setSaved(false)
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      let uploadedPath: string | null = null
      let nextCoverUrl = selectedCover

      if (coverFile) {
        const database = createClient()
        const { data: { user }, error: userError } = await database.auth.getUser()
        if (userError || !user) {
          setMessage('Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.')
          return
        }

        const extensionByType: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        }
        uploadedPath = `${user.id}/${window.crypto.randomUUID()}.${extensionByType[coverFile.type]}`
        const { error: uploadError } = await database.storage
          .from('event-covers')
          .upload(uploadedPath, coverFile, { contentType: coverFile.type, upsert: false })

        if (uploadError) {
          console.error('Etkinlik arka planı yüklenemedi:', uploadError)
          setMessage('Arka plan fotoğrafı yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.')
          return
        }

        const { data: { privateUrl } } = database.storage.from('event-covers').getPrivateUrl(uploadedPath)
        nextCoverUrl = privateUrl
      }

      formData.set('eventId', eventId)
      formData.set('cover_image_url', nextCoverUrl)
      const result = await updateOwnedEvent(formData)
      if (result.error) {
        if (uploadedPath) {
          const { error: cleanupError } = await createClient().storage.from('event-covers').remove([uploadedPath])
          if (cleanupError) console.error('Kullanılmayan etkinlik arka planı temizlenemedi:', cleanupError)
        }
        setMessage(result.error)
        return
      }

      setSelectedCover(nextCoverUrl)
      setCoverFile(null)
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form className={styles.editEventForm} onSubmit={handleSubmit}>
      <input type="hidden" name="eventId" value={eventId} />
      <label htmlFor={`edit-event-date-${eventId}`}>Etkinlik tarihi</label>
      <input
        id={`edit-event-date-${eventId}`}
        name="event_date"
        type="date"
        defaultValue={eventDate}
        required
      />
      <label htmlFor={`edit-event-time-${eventId}`}>Etkinlik saati <span>(isteğe bağlı)</span></label>
      <input
        id={`edit-event-time-${eventId}`}
        name="event_time"
        type="time"
        defaultValue={eventTime?.slice(0, 5) ?? ''}
      />
      <label htmlFor={`edit-event-address-${eventId}`}>Etkinlik adresi <span>(isteğe bağlı)</span></label>
      <input
        id={`edit-event-address-${eventId}`}
        name="event_address"
        type="text"
        maxLength={300}
        autoComplete="street-address"
        defaultValue={eventAddress ?? ''}
      />
      <label htmlFor={`edit-event-message-${eventId}`}>Misafirler için açıklama</label>
      <textarea
        id={`edit-event-message-${eventId}`}
        name="welcome_message"
        rows={3}
        maxLength={500}
        defaultValue={welcomeMessage}
      />
      <fieldset className={styles.editCoverOptions}>
        <legend>Etkinlik arka planı</legend>
        <div className={styles.editCoverGrid}>
          {sampleCovers.map((cover) => (
            <button
              aria-pressed={!coverFile && selectedCover === cover.src}
              className={`${styles.editCoverOption} ${!coverFile && selectedCover === cover.src ? styles.editCoverOptionSelected : ''}`}
              key={cover.src}
              onClick={() => {
                setSelectedCover(cover.src)
                setCoverFile(null)
                setSaved(false)
                setMessage('')
              }}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover.src} alt="" />
              <span>{cover.label}</span>
            </button>
          ))}
        </div>
        <label className={styles.editCoverUpload} htmlFor={`edit-event-cover-${eventId}`}>
          {coverFile ? 'Başka bir fotoğraf seç' : 'Telefondan fotoğraf seç'}
        </label>
        <input
          id={`edit-event-cover-${eventId}`}
          className={styles.editCoverFile}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={chooseCoverFile}
        />
        <span className={styles.editCoverHint}>JPEG, PNG veya WebP · En fazla 5 MB. Bu görsel etkinlik sayfasında herkese açık görünür.</span>
        {coverPreview && (
          <div className={styles.editCoverPreview}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverPreview} alt="Etkinlik arka planı önizlemesi" />
            <span>{coverFile ? 'Seçtiğiniz fotoğraf kullanılacak' : 'Seçili arka plan'}</span>
          </div>
        )}
      </fieldset>
      {message && <p className={styles.editEventMessage} role="alert">{message}</p>}
      {saved && <p className={styles.editEventSuccess} role="status">Etkinlik bilgileri ve arka planı güncellendi.</p>}
      <button type="submit" disabled={isPending}>
        {isPending ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}
      </button>
    </form>
  )
}
