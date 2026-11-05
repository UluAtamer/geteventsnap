'use client'

import { useEffect, useState, useTransition, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createEvent } from '@/app/dashboard/actions'
import { createClient } from '@/lib/supabase/client'
import styles from './CreateEventForm.module.css'

const eventTypes = [
  { id: 'dugun', label: 'Düğün', icon: '♡', description: 'Düğün ve nişan' },
  { id: 'arkadas', label: 'Arkadaş buluşması', icon: '☀', description: 'Dostlarla bir arada' },
  { id: 'parti', label: 'Parti', icon: '✦', description: 'Kutlama ve eğlence' },
  { id: 'diger', label: 'Diğer', icon: '✿', description: 'Her türlü etkinlik' },
] as const

type EventType = typeof eventTypes[number]['id']

const sampleCovers: { type: EventType; src: string; label: string }[] = [
  { type: 'dugun', src: '/covers/dugun.svg', label: 'Romantik bahçe' },
  { type: 'arkadas', src: '/covers/arkadas.svg', label: 'Dostlarla buluşma' },
  { type: 'parti', src: '/covers/parti.svg', label: 'Işıl ışıl parti' },
  { type: 'diger', src: '/covers/diger.svg', label: 'Bahçe sofrası' },
]

const MAX_COVER_SIZE = 5 * 1024 * 1024
const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function CreateEventForm() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [created, setCreated] = useState(false)
  const [eventType, setEventType] = useState<EventType>('dugun')
  const [sampleCover, setSampleCover] = useState('/covers/dugun.svg')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('')
      return
    }

    const previewUrl = URL.createObjectURL(coverFile)
    setCoverPreview(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [coverFile])

  function handleCoverSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    setError('')
    if (!file) {
      setCoverFile(null)
      return
    }
    if (!ALLOWED_COVER_TYPES.includes(file.type)) {
      event.currentTarget.value = ''
      setCoverFile(null)
      setError('Lütfen JPEG, PNG veya WebP biçiminde bir fotoğraf seçin.')
      return
    }
    if (file.size > MAX_COVER_SIZE) {
      event.currentTarget.value = ''
      setCoverFile(null)
      setError('Kapak görseli en fazla 5 MB olabilir.')
      return
    }

    setCoverFile(file)
    event.currentTarget.value = ''
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setCreated(false)
    const formData = new FormData(form)
    formData.set('event_type', eventType)

    startTransition(async () => {
      let uploadedPath: string | null = null

      if (coverFile) {
        const supabase = createClient()
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (userError || !user) {
          setError('Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.')
          return
        }

        const extensionByType: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        }
        uploadedPath = `${user.id}/${crypto.randomUUID()}.${extensionByType[coverFile.type]}`
        const { error: uploadError } = await supabase.storage
          .from('event-covers')
          .upload(uploadedPath, coverFile, { contentType: coverFile.type, upsert: false })

        if (uploadError) {
          console.error('Etkinlik kapak görseli yüklenemedi:', uploadError)
          setError('Kapak fotoğrafı yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.')
          return
        }

        const { data: { publicUrl } } = supabase.storage.from('event-covers').getPublicUrl(uploadedPath)
        formData.set('cover_image_url', publicUrl)
      } else {
        formData.set('cover_image_url', sampleCover)
      }

      const result = await createEvent(formData)
      if (result.error) {
        if (uploadedPath) {
          const { error: cleanupError } = await createClient().storage.from('event-covers').remove([uploadedPath])
          if (cleanupError) {
            console.error('Kullanılmayan kapak görseli temizlenemedi:', cleanupError)
          }
        }
        setError(result.error)
        return
      }
      if (!result.eventSlug) {
        setError('Etkinlik oluşturulamadı. Tekrar deneyin.')
        return
      }

      setCreated(true)
      form.reset()
      setEventType('dugun')
      setSampleCover('/covers/dugun.svg')
      setCoverFile(null)
      setIsOpen(false)
      router.refresh()
    })
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelText}>
        <span className={styles.panelIcon} aria-hidden="true">+</span>
        <div>
          <h2>Yeni etkinlik oluştur</h2>
          <p>Bilgileri girin; size özel paylaşım bağlantısı ve QR kodu hazırlansın.</p>
        </div>
      </div>
      {!isOpen && (
        <button className={styles.openButton} type="button" onClick={() => setIsOpen(true)}>
          Etkinlik oluştur
        </button>
      )}

      {isOpen && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <fieldset className={styles.typeFieldset}>
            <legend>Etkinlik türü</legend>
            <div className={styles.typeGrid}>
              {eventTypes.map((type) => (
                <button
                  aria-pressed={eventType === type.id}
                  className={`${styles.typeOption} ${eventType === type.id ? styles.typeOptionSelected : ''}`}
                  key={type.id}
                  onClick={() => {
                    setEventType(type.id)
                    setSampleCover(`/covers/${type.id}.svg`)
                    setCoverFile(null)
                    setError('')
                  }}
                  type="button"
                >
                  <span className={styles.typeIcon} aria-hidden="true">{type.icon}</span>
                  <span className={styles.typeLabel}>{type.label}</span>
                  <span className={styles.typeDescription}>{type.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label htmlFor="event-title">Etkinlik adı</label>
          <input
            id="event-title"
            name="title"
            type="text"
            minLength={2}
            maxLength={100}
            placeholder="Örnek: Elif ve Mert'in Düğünü"
            autoComplete="off"
            required
          />
          <label htmlFor="event-date">Etkinlik tarihi</label>
          <input id="event-date" name="event_date" type="date" required />
          <label htmlFor="event-time">Etkinlik saati <span className={styles.optional}>(isteğe bağlı)</span></label>
          <input id="event-time" name="event_time" type="time" />
          <label htmlFor="event-address">Etkinlik adresi <span className={styles.optional}>(isteğe bağlı)</span></label>
          <input
            id="event-address"
            name="event_address"
            type="text"
            maxLength={300}
            autoComplete="street-address"
            placeholder="Örnek: Kadıköy, İstanbul"
          />
          <p className={styles.hint}>Adres eklenirse misafirler etkinlik sayfasındaki “Adrese git” düğmesiyle haritayı açabilir.</p>
          <label htmlFor="event-welcome">Misafirler için hoş geldiniz mesajı</label>
          <textarea
            id="event-welcome"
            name="welcome_message"
            rows={3}
            maxLength={500}
            placeholder="Bu güzel günümüzün anılarını bizimle paylaşın."
          />
          <input name="cover_image_url" type="hidden" value={sampleCover} readOnly />

          <fieldset className={styles.coverFieldset}>
            <legend>Etkinlik kapağı</legend>
            <p className={styles.hint}>Bir hazır kapak seçin ya da telefonunuzdan kendi fotoğrafınızı ekleyin.</p>
            <div className={styles.coverGrid}>
              {sampleCovers.map((cover) => (
                <button
                  aria-pressed={!coverFile && sampleCover === cover.src}
                  className={`${styles.coverOption} ${!coverFile && sampleCover === cover.src ? styles.coverOptionSelected : ''}`}
                  key={cover.src}
                  onClick={() => { setSampleCover(cover.src); setCoverFile(null); setError('') }}
                  type="button"
                >
                  {/* Custom, bundled sample illustrations. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover.src} alt="" />
                  <span>{cover.label}</span>
                </button>
              ))}
            </div>
            <label className={styles.uploadLabel} htmlFor="event-cover-file">
              <span className={styles.uploadIcon} aria-hidden="true">＋</span>
              <span>{coverFile ? 'Başka bir fotoğraf seç' : 'Telefondan fotoğraf seç'}</span>
            </label>
            <input
              className={styles.fileInput}
              id="event-cover-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleCoverSelection}
            />
            <p className={styles.hint}>JPEG, PNG veya WebP · En fazla 5 MB. Fotoğraf seçmezseniz yukarıdaki hazır kapak kullanılır.</p>
            <p className={styles.hint}>Kapak etkinlik sayfasında herkese açık görünür; özel veya hassas fotoğraf kullanmayın.</p>
            {coverPreview && (
              <div className={styles.preview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverPreview} alt="Seçtiğiniz kapak fotoğrafının önizlemesi" />
                <span>Seçtiğiniz fotoğraf kullanılacak</span>
              </div>
            )}
          </fieldset>

          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.buttons}>
            <button className={styles.cancel} type="button" onClick={() => {
              setIsOpen(false)
              setError('')
              setCoverFile(null)
              setEventType('dugun')
              setSampleCover('/covers/dugun.svg')
            }}>
              Vazgeç
            </button>
            <button className={styles.submit} type="submit" disabled={isPending}>
              {isPending ? 'Oluşturuluyor…' : 'Etkinliği oluştur'}
            </button>
          </div>
        </form>
      )}

      {created && (
        <p className={styles.success} role="status">
          Etkinliğiniz oluşturuldu! Bağlantı ve QR kodu etkinlik kartınızda hazır.
        </p>
      )}
    </section>
  )
}
