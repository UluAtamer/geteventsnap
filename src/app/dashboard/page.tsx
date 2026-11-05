import BrandLogo from '@/components/brand/BrandLogo'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import CreateEventForm from '@/components/events/CreateEventForm'
import EventShareCard from '@/components/events/EventShareCard'
import EditEventForm from '@/components/events/EditEventForm'
import { getEventUploadWindow } from '@/lib/event-upload-window'
import { getMemberCode } from '@/lib/member-code'
import { isAdminUser } from '@/lib/admin-access'
import { hasGoogleDriveServerConfig } from '@/lib/google-drive'
import { createAdminClient } from '@/lib/db/admin'
import { deleteOwnedEvent, signOut } from './actions'
import { createClient } from '@/lib/db/server'
import styles from './dashboard.module.css'

type DashboardPageProps = {
  searchParams: Promise<{ drive?: string | string[]; panel?: string | string[] }>
}

type DriveConnection = {
  event_id: string
  drive_folder_url: string
  connection_status: string
}

const eventTypeLabels: Record<string, string> = {
  dugun: 'Düğün',
  arkadas: 'Arkadaş buluşması',
  parti: 'Parti',
  diger: 'Diğer',
}

const driveMessages: Record<string, { text: string; success?: boolean }> = {
  connected: { text: 'Google Drive bağlandı. Etkinlik anıları için klasörünüz hazır.', success: true },
  already_connected: { text: 'Bu etkinliğin Google Drive klasörü zaten bağlı.' },
  setup_required: { text: 'Google Drive’ı bağlamadan önce Google Cloud ve sunucu anahtarı ayarlarını tamamlayın. Kurulum adımları README dosyasında.' },
  connection_check_failed: { text: 'Drive bağlantı durumu okunamadı. Lütfen ayarları kontrol edip sayfayı yenileyin.' },
  cancelled: { text: 'Google Drive bağlantısı iptal edildi; hiçbir Drive erişimi kaydedilmedi.' },
  access_denied: { text: 'Google Drive erişimi reddedildi. Uygulama Google Cloud’da Testing durumundaysa Audience bölümünden Publish app ile herkese açın. Test kullanıcıları kısıtlaması kalksa da kullanıcıların Google izin ekranında onay vermesi gerekir. Google Workspace hesabı kullanıyorsanız kuruluş yöneticiniz ayrıca erişimi engelliyor olabilir.' },
  invalid_state: { text: 'Google bağlantı isteğinin güvenlik doğrulaması başarısız oldu. Lütfen yeniden deneyin.' },
  session_expired: { text: 'Oturum süreniz dolmuş. Giriş yapıp Google Drive bağlantısını yeniden başlatın.' },
  event_not_found: { text: 'Etkinlik doğrulanamadı. Paneli yenileyip tekrar deneyin.' },
  refresh_token_missing: { text: 'Google kalıcı erişim izni vermedi. Bağlantıyı yeniden başlatıp izin ekranını onaylayın.' },
  save_failed: { text: 'Drive klasörü oluşturuldu ancak bağlantı güvenli biçimde kaydedilemedi. Lütfen yeniden deneyin.' },
  oauth_failed: { text: 'Google Drive bağlantısı tamamlanamadı. Google ayarlarını kontrol edip yeniden deneyin.' },
}

type EventRecord = {
  id: string
  title: string
  event_date: string
  event_time: string | null
  event_address: string | null
  event_type: string
  slug: string
  welcome_message: string
  cover_image_url: string | null
}

type UploadStats = {
  event_id: string
  file_count: number
  guest_count: number
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const driveMessageKey = Array.isArray(params.drive) ? params.drive[0] : params.drive
  const driveMessage = driveMessageKey ? driveMessages[driveMessageKey] : undefined
  const panelMessageKey = Array.isArray(params.panel) ? params.panel[0] : params.panel
  const panelMessages: Record<string, string> = {
    event_deleted: 'Etkinlik ve uygulamadaki ilişkili kayıtları silindi. Google Drive’daki dosyalar etkilenmedi.',
    event_delete_confirmation: 'Silmek için onay alanına ETKİNLİĞİ SİL yazın.',
    event_delete_failed: 'Etkinlik silinemedi. Sunucu kayıtlarında hata ayrıntısı bulunuyor; lütfen tekrar deneyin.',
    settings_invalid: 'Etkinlik ayarı geçerli değildi. Lütfen panelden tekrar deneyin.',
    event_updated: 'Etkinlik bilgileri güncellendi.',
    event_update_invalid: 'Etkinlik tarihi, saati veya açıklaması geçerli değil. Alanları kontrol edip tekrar deneyin.',
    event_update_failed: 'Etkinlik bilgileri kaydedilemedi. Lütfen tekrar deneyin.',
    event_not_found: 'Etkinlik bulunamadı veya bu etkinlik size ait değil.',
  }
  const panelMessage = panelMessageKey ? panelMessages[panelMessageKey] : undefined
  const database = await createClient()
  const { data: { user } } = await database.auth.getUser()

  if (!user) {
    redirect('/giris')
  }

  const { data, error } = await database
    .from('events')
    .select('id, title, event_date, event_time, event_address, event_type, slug, welcome_message, cover_image_url')
    .order('created_at', { ascending: false })

  const events = (data ?? []) as EventRecord[]
  let driveConnections: DriveConnection[] = []
  let driveConnectionsError = ''
  let uploadStats: UploadStats[] = []
  let uploadStatsError = ''

  if (error) {
    console.error('Etkinlik listesi alınamadı:', error)
  }

  if (events.length > 0) {
    const admin = createAdminClient()
    const { data: connections, error: driveError } = await admin
      .from('event_drive_connections')
      .select('event_id, drive_folder_url, connection_status')
      .eq('owner_id', user.id)
      .in('event_id', events.map((event) => event.id))

    if (driveError) {
      console.error('Google Drive bağlantı durumu alınamadı:', driveError)
      driveConnectionsError = 'query'
    } else {
      driveConnections = (connections ?? []) as DriveConnection[]
    }
  }

  if (events.length > 0) {
    const { data: stats, error: statsError } = await database.rpc('get_owner_event_upload_stats')
    if (statsError) {
      console.error('Etkinlik yükleme sayaçları alınamadı:', statsError)
      uploadStatsError = 'Yükleme sayaçları şu anda alınamıyor. Lütfen sayfayı yenileyin.'
    } else {
      uploadStats = (stats ?? []) as UploadStats[]
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
        <BrandLogo className={styles.brandLogo} />
        </Link>
        <div className={styles.headerActions}>
          <Link href="/sifre-yenile">Parola değiştir</Link>
          {isAdminUser(user) && (
            <Link className={styles.adminLink} href="/admin">Yönetim paneli</Link>
          )}
          <form action={signOut}>
            <button className={styles.signOut} type="submit">Güvenli çıkış yap</button>
          </form>
        </div>
      </header>

      <section className={styles.content}>
        <p className={styles.eyebrow}>ETKİNLİK SAHİBİ PANELİ</p>
        <h1>Merhaba, hoş geldiniz</h1>
        <p className={styles.account}>Hesap: <strong>{user.email}</strong></p>
        <p className={styles.account}>Üye kodunuz: <strong>{getMemberCode(user.id)}</strong> — destek için bu kodu paylaşın.</p>

        {driveMessage && (
          <div className={`${styles.driveNotice} ${driveMessage.success ? styles.driveNoticeSuccess : ''}`} role="status">
            {driveMessage.text}
          </div>
        )}
        {panelMessage && (
          <div className={`${styles.driveNotice} ${panelMessageKey === 'event_deleted' ? styles.driveNoticeSuccess : ''}`} role={panelMessageKey === 'event_delete_failed' ? 'alert' : 'status'}>
            {panelMessage}
          </div>
        )}
        {!hasGoogleDriveServerConfig() && !driveMessage && (
          <div className={styles.driveNotice} role="status">
            Google Drive bağlantısı henüz ayarlanmadı. Google Cloud bilgileri ve sunucu anahtarını eklediğinizde etkinlik klasörünü bağlayabilirsiniz. Kurulum adımları README dosyasında.
          </div>
        )}
        {driveConnectionsError && (
          <div className={styles.driveNotice} role="alert">
            Google Drive bağlantı durumu okunamadı. Lütfen ayarları kontrol edin.
          </div>
        )}
        {uploadStatsError && (
          <div className={styles.driveNotice} role="alert">
            {uploadStatsError}
          </div>
        )}

        {error ? (
          <div className={styles.notice} role="alert">
            Etkinlikler yüklenemedi. Lütfen sayfayı yenileyin veya daha sonra tekrar deneyin.
          </div>
        ) : (
          <>
            <CreateEventForm />
            <section className={styles.eventsSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>SİZİN ETKİNLİKLERİNİZ</p>
                  <h2>Etkinliklerim</h2>
                </div>
                <span className={styles.eventCount}>{events.length} etkinlik</span>
              </div>
              {events.length === 0 ? (
                <div className={styles.empty}>
                  <span aria-hidden="true" className={styles.emptyIcon}>♡</span>
                  <h3>Henüz etkinliğiniz yok</h3>
                  <p>Yukarıdaki formdan ilk etkinliğinizi oluşturun. QR kodunuz hemen hazır olacak.</p>
                </div>
              ) : (
                <div className={styles.eventGrid}>
                  {events.map((event) => {
                    const connection = driveConnections.find((item) => item.event_id === event.id)
                    const stats = uploadStats.find((item) => item.event_id === event.id)
                    const uploadState = getEventUploadWindow(event.event_date).state
                    const statusLabel = uploadState === 'open'
                      ? 'Anı toplama açık'
                      : uploadState === 'closed'
                        ? 'Tamamlandı'
                        : 'Yaklaşan etkinlik'
                    const statusClass = uploadState === 'open'
                      ? styles.statusActive
                      : uploadState === 'closed'
                        ? styles.statusComplete
                        : styles.statusUpcoming
                    return (
                    <article className={styles.eventCard} key={event.id}>
                      {!driveConnectionsError && (
                        <div className={styles.drivePanel}>
                          {connection?.connection_status === 'connected' ? (
                            <>
                              <span className={styles.driveConnected}>Google Drive bağlı</span>
                              <a className={styles.driveButton} href={connection.drive_folder_url} target="_blank" rel="noreferrer">
                                Drive klasörünü aç
                              </a>
                            </>
                          ) : (
                            <>
                              <span
                                className={styles.driveDisconnected}
                                role={connection?.connection_status === 'reauth_required' ? 'alert' : undefined}
                              >
                                {connection?.connection_status === 'reauth_required'
                                  ? 'Google Drive bağlantısı kesildi. Yeniden bağlayın.'
                                  : 'Fotoğraflarınız için kendi Drive’ınızı bağlayın.'}
                              </span>
                              <a className={styles.driveButton} href={`/api/google/drive/connect?eventId=${encodeURIComponent(event.id)}`}>
                                {connection?.connection_status === 'reauth_required' ? 'Yeniden bağla' : 'Google Drive’ı bağla'}
                              </a>
                            </>
                          )}
                        </div>
                      )}
                      <div
                        className={styles.invitation}
                        style={{ backgroundImage: `linear-gradient(180deg, rgba(30, 15, 23, .08), rgba(30, 15, 23, .78)), url("${event.cover_image_url ?? ''}")` }}
                      >
                        <div className={styles.invitationFrame}>
                          <span>{eventTypeLabels[event.event_type] ?? 'Etkinlik'}</span>
                          <strong>{event.title}</strong>
                          <time dateTime={event.event_date}>
                            {new Intl.DateTimeFormat('tr-TR', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              timeZone: 'Europe/Istanbul',
                            }).format(new Date(`${event.event_date}T12:00:00+03:00`))}
                          </time>
                          {event.event_time && <span>Saat {event.event_time.slice(0, 5)}</span>}
                        </div>
                      </div>
                      <div className={styles.eventDetails}>
                        {event.welcome_message && <p>{event.welcome_message}</p>}
                        {event.event_address && (
                          <div className={styles.locationDetails}>
                            <span>Adres: {event.event_address}</span>
                          </div>
                        )}
                      </div>
                      <details className={styles.editEvent}>
                        <summary>Etkinlik bilgilerini düzenle</summary>
                        <EditEventForm
                          eventId={event.id}
                          eventDate={event.event_date}
                          eventTime={event.event_time}
                          eventAddress={event.event_address}
                          welcomeMessage={event.welcome_message}
                          coverImageUrl={event.cover_image_url}
                        />
                      </details>
                      <div className={styles.eventControls}>
                        <span className={`${styles.eventStatus} ${statusClass}`}>{statusLabel}</span>
                        {stats && (
                          <>
                            <dl className={styles.eventStats}>
                              <div>
                                <dt>Yüklenen dosya</dt>
                                <dd>{stats.file_count.toLocaleString('tr-TR')}</dd>
                              </div>
                              <div>
                                <dt>Yükleyen misafir</dt>
                                <dd>{stats.guest_count.toLocaleString('tr-TR')}</dd>
                              </div>
                            </dl>
                            <p className={styles.controlNote}>
                              Misafir sayısı farklı tarayıcılardan başarılı yükleme yapanları sayar; ad veya e-posta saklanmaz.
                            </p>
                          </>
                        )}
                      </div>
                      <EventShareCard
                        slug={event.slug}
                        title={event.title}
                        eventAddress={event.event_address}
                        eventTime={event.event_time}
                      />
                      <form action={deleteOwnedEvent} className={styles.deleteEventForm}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <label htmlFor={`delete-event-${event.id}`}>
                          Etkinliği kalıcı silmek için <strong>ETKİNLİĞİ SİL</strong> yazın. Uygulamadaki etkinlik kayıtları silinir; Google Drive dosyaları kalır.
                        </label>
                        <div>
                          <input id={`delete-event-${event.id}`} name="confirmation" required />
                          <button type="submit">Etkinliği sil</button>
                        </div>
                      </form>
                    </article>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
