import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import DatingModule from '@/components/events/DatingModule'
import GuestUploadForm from '@/components/events/GuestUploadForm'
import { getGuestUploadLimits } from '@/lib/guest-upload'
import { guestCoverSource } from '@/lib/cover-url'
import { getEventUploadWindow } from '@/lib/event-upload-window'
import { database } from '@/lib/db/core'
import styles from './event.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Anı yükle',
  description: 'Fotoğraf ve videolarınızı etkinlik sahibine özel olarak gönderin.',
  robots: { index: false, follow: false, noarchive: true },
  openGraph: { title: 'Anı yükle | GetEventSnap', description: 'Özel anı yükleme alanı.', images: ['/logo.png'] },
  twitter: { title: 'Anı yükle | GetEventSnap', description: 'Özel anı yükleme alanı.', images: ['/logo.png'] },
}

export default async function GuestEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Owner names and event details never enter guest HTML or RSC props; the cover is only a preset path or a slug-scoped address.
  const event = await database().prepare(`SELECT event_date,dating_enabled,
    CASE WHEN cover_image_url LIKE '/covers/%' THEN cover_image_url END AS preset_cover,
    coalesce(cover_image_url LIKE '/api/covers/%', false) AS has_uploaded_cover
    FROM events WHERE slug=?`).get(slug)
  if (!event) notFound()
  const cover = guestCoverSource(slug, event.preset_cover, event.has_uploaded_cover)
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.invitation} style={cover ? { backgroundImage: `linear-gradient(180deg, rgba(38, 20, 27, .25), rgba(38, 20, 27, .83)), url("${cover}")` } : undefined}>
          <Link href="/" className={styles.homeIcon} aria-label="Anasayfaya dön" title="Anasayfaya dön">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 11.2 12 4l8.5 7.2" />
              <path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.8" />
            </svg>
          </Link>
          <p className={styles.brand}>GetEventSnap</p>
          <h1>Anılarınızı paylaşın</h1>
          <p>Yükledikleriniz etkinlik sahibinin özel Google Drive klasörüne gönderilir. Başka misafirlerin dosyalarını göremezsiniz.</p>
        </div>
        <DatingModule slug={slug} enabled={event.dating_enabled === true} />
        <GuestUploadForm slug={slug} initialWindowState={getEventUploadWindow(String(event.event_date)).state} limits={getGuestUploadLimits()} />
      </section>
    </main>
  )
}
