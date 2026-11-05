import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import GuestUploadForm from '@/components/events/GuestUploadForm'
import DatingModule from '@/components/events/DatingModule'
import { getGuestUploadLimits } from '@/lib/guest-upload'
import { getMapDirectionsUrl } from '@/lib/event-location'
import { createPublicClient } from '@/lib/supabase/public'
import styles from './event.module.css'

const eventTypeLabels: Record<string, string> = {
  dugun: 'Düğün',
  arkadas: 'Arkadaş buluşması',
  parti: 'Parti',
  diger: 'Diğer etkinlik',
}

const eventTypeEyebrows: Record<string, string> = {
  dugun: 'DÜĞÜNÜNÜZÜN GÜZEL ANILARI',
  arkadas: 'DOSTLARLA BİRİKEN ANILAR',
  parti: 'KUTLAMANIN EN GÜZEL ANLARI',
  diger: 'ETKİNLİĞİNİZİN GÜZEL ANILARI',
}

type EventPageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { slug } = await params
  const supabase = createPublicClient()
  const { data } = await supabase.rpc('get_public_event_details', { event_slug: slug })
  const event = data?.[0]

  if (!event) {
    return {
      title: 'Etkinlik sayfası',
      robots: { index: false, follow: false },
    }
  }

  const description = event.welcome_message
    || `${event.title} etkinliğinin fotoğraf ve videolarını GetEventSnap ile keşfedin.`
  const title = event.title
  const socialTitle = `${title} | GetEventSnap`

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      locale: 'tr_TR',
      url: `/e/${slug}`,
      title: socialTitle,
      description,
      images: event.cover_image_url ? [{ url: event.cover_image_url, alt: event.title }] : ['/logo.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: event.cover_image_url ? [event.cover_image_url] : ['/logo.png'],
    },
  }
}

export default async function GuestEventPage({ params }: EventPageProps) {
  const { slug } = await params
  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('get_public_event_details', { event_slug: slug })

  if (error) {
    console.error('Paylaşılan etkinlik alınamadı:', error)
    throw new Error('Etkinlik şu anda açılamıyor. Lütfen daha sonra tekrar deneyin.')
  }

  const event = data?.[0]
  if (!event) {
    notFound()
  }

  const formattedDate = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(`${event.event_date}T12:00:00+03:00`))

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div
          className={styles.invitation}
          style={{ backgroundImage: `linear-gradient(180deg, rgba(38, 20, 27, .25), rgba(38, 20, 27, .83)), url("${event.cover_image_url ?? ''}")` }}
        >
          <Link href="/" className={styles.homeIcon} aria-label="Anasayfaya dön" title="Anasayfaya dön">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 11.2 12 4l8.5 7.2" />
              <path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.8" />
            </svg>
          </Link>
          <Link href="/" className={styles.brand}>GetEventSnap</Link>
          <p className={styles.eyebrow}>
            {eventTypeEyebrows[event.event_type] ?? 'BU GÜZEL GÜNÜN ANILARI'}
          </p>
          <span className={styles.eventType}>
            {eventTypeLabels[event.event_type] ?? 'Etkinlik'}
          </span>
          <h1>{event.title}</h1>
          <p className={styles.date}>{formattedDate}</p>
          {event.event_time && <p className={styles.time}>Saat {event.event_time.slice(0, 5)}</p>}
          {event.welcome_message && <p className={styles.message}>{event.welcome_message}</p>}
        </div>
        {event.event_address && (
          <div className={styles.location}>
            <p><strong>Etkinlik adresi</strong><br />{event.event_address}</p>
            <a href={getMapDirectionsUrl(event.event_address)} target="_blank" rel="noreferrer">
              Adrese git
            </a>
          </div>
        )}
        <GuestUploadForm
          slug={slug}
          eventDate={event.event_date}
          limits={getGuestUploadLimits()}
        />
        <DatingModule slug={slug} enabled={event.dating_enabled === true} />
      </section>
    </main>
  )
}
