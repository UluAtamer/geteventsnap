import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import GuestUploadForm from '@/components/events/GuestUploadForm'
import { getGuestUploadLimits } from '@/lib/guest-upload'
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
  // Read only the upload window; owner names, event details and covers never enter guest HTML or RSC props.
  const event = await database().prepare('SELECT event_date FROM events WHERE slug=?').get(slug)
  if (!event) notFound()
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.invitation}>
          <p className={styles.brand}>GetEventSnap</p>
          <h1>Anılarınızı paylaşın</h1>
          <p>Yükledikleriniz etkinlik sahibinin özel Google Drive klasörüne gönderilir. Başka misafirlerin dosyalarını göremezsiniz.</p>
        </div>
        <GuestUploadForm slug={slug} initialWindowState={getEventUploadWindow(String(event.event_date)).state} limits={getGuestUploadLimits()} />
      </section>
    </main>
  )
}
