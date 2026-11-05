import Link from 'next/link'
import { requireAdmin } from '@/lib/admin-auth'
import { getMemberCode } from '@/lib/member-code'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteEvent, deleteUser, setUserAccess, updateEvent } from './actions'
import styles from './admin.module.css'

export const dynamic = 'force-dynamic'

type AdminPageProps = {
  searchParams: Promise<{ q?: string | string[]; notice?: string | string[] }>
}

type AdminUser = {
  id: string
  email?: string
  created_at: string
  banned_until?: string
  last_sign_in_at?: string
}

type AdminEvent = {
  id: string
  owner_id: string
  title: string
  event_date: string
  slug: string
  created_at: string
}

const notices: Record<string, string> = {
  event_saved: 'Etkinlik bilgileri güncellendi.',
  event_deleted: 'Etkinlik ve uygulamadaki ilişkili kayıtları silindi. Google Drive’daki dosyalar etkilenmedi.',
  user_banned: 'Kullanıcı hesabı geçici olarak kilitlendi.',
  user_unbanned: 'Kullanıcı hesabının kilidi açıldı.',
  user_deleted: 'Kullanıcı kalıcı olarak silindi. İlişkili etkinlik ve uygulama kayıtları da silinmiş olabilir.',
  confirmation_required: 'İşlem yapılmadı. Onay ifadesini kontrol edip yeniden deneyin.',
  self_protected: 'Yönetici hesabınız bu işlemden korundu.',
  invalid: 'Girilen bilgiler geçersiz; hiçbir değişiklik yapılmadı.',
  event_not_found: 'Etkinlik bulunamadı; hiçbir değişiklik yapılmadı.',
  save_failed: 'Etkinlik kaydedilemedi. Sunucu kayıtlarını kontrol edin.',
  delete_failed: 'Silme işlemi tamamlanamadı. Sunucu kayıtlarını kontrol edin.',
  user_action_failed: 'Hesap işlemi tamamlanamadı. Sunucu kayıtlarını kontrol edin.',
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const currentAdmin = await requireAdmin()
  const params = await searchParams
  const query = (Array.isArray(params.q) ? params.q[0] : params.q ?? '').trim().toLocaleLowerCase('tr-TR')
  const noticeKey = Array.isArray(params.notice) ? params.notice[0] : params.notice
  const admin = createAdminClient()

  const users: AdminUser[] = []
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) {
      console.error('Yönetici kullanıcı listesi alınamadı:', error)
      throw new Error('Kullanıcı listesi yüklenemedi.')
    }
    users.push(...data.users)
    if (data.users.length < 100) break
    if (page === 100) throw new Error('Kullanıcı listesi sayfalama sınırını aştı.')
  }

  const { data: profileRows, error: profilesError } = await admin
    .from('profiles')
    .select('id, full_name')
  if (profilesError) {
    console.error('Yönetici profil listesi alınamadı:', profilesError)
    throw new Error('Profil listesi yüklenemedi.')
  }
  const names = new Map((profileRows ?? []).map((profile) => [profile.id, profile.full_name ?? '']))

  const { data: eventRows, error: eventsError } = await admin
    .from('events')
    .select('id, owner_id, title, event_date, slug, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (eventsError) {
    console.error('Yönetici etkinlik listesi alınamadı:', eventsError)
    throw new Error('Etkinlik listesi yüklenemedi.')
  }
  const events = (eventRows ?? []) as AdminEvent[]

  const now = Date.now()
  const signedInUsers = users.filter((user) => user.last_sign_in_at)
  const signedIn24h = signedInUsers.filter((user) => now - new Date(user.last_sign_in_at as string).getTime() <= 86_400_000).length
  const signedIn7d = signedInUsers.filter((user) => now - new Date(user.last_sign_in_at as string).getTime() <= 7 * 86_400_000).length

  let totalUploads = 0
  const sharers = new Set<string>()
  let unattributedUploads = 0
  for (let from = 0; from < 200000; from += 1000) {
    const { data: uploadRows, error: uploadsError } = await admin
      .from('uploads_meta')
      .select('event_id, guest_hash')
      .order('id')
      .range(from, from + 999)
    if (uploadsError) {
      console.error('Yönetici yükleme istatistikleri alınamadı:', uploadsError)
      throw new Error('Yükleme istatistikleri yüklenemedi.')
    }
    for (const row of uploadRows ?? []) {
      totalUploads += 1
      if (row.guest_hash) sharers.add(`${row.event_id}:${row.guest_hash}`)
      else unattributedUploads += 1
    }
    if ((uploadRows?.length ?? 0) < 1000) break
  }
  const userById = new Map(users.map((user) => [user.id, user]))
  const eventCounts = new Map<string, number>()
  for (const event of events) {
    eventCounts.set(event.owner_id, (eventCounts.get(event.owner_id) ?? 0) + 1)
  }

  const filteredUsers = users.filter((user) => {
    const searchable = `${user.email ?? ''} ${names.get(user.id) ?? ''} ${user.id}`.toLocaleLowerCase('tr-TR')
    return !query || searchable.includes(query)
  })
  const filteredEvents = events.filter((event) => {
    const owner = userById.get(event.owner_id)
    const searchable = `${event.title} ${event.slug} ${owner?.email ?? ''}`.toLocaleLowerCase('tr-TR')
    return !query || searchable.includes(query)
  })
  const dateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' })

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/dashboard">GetEventSnap <span>Yönetim</span></Link>
        <Link className={styles.back} href="/dashboard">← Panele dön</Link>
      </header>
      <div className={styles.content}>
        <p className={styles.eyebrow}>YÖNETİCİ ALANI</p>
        <h1>Hesapları ve etkinlikleri yönetin</h1>
        <p className={styles.intro}>Giriş yapan yönetici: {currentAdmin.email}</p>

        {noticeKey && notices[noticeKey] && <p className={styles.notice} role="status">{notices[noticeKey]}</p>}

        <div className={styles.stats}>
          <div><strong>{users.length}</strong><span>Kayıtlı üye</span></div>
          <div><strong>{signedInUsers.length}</strong><span>Giriş yapmış üye</span></div>
          <div><strong>{signedIn24h}</strong><span>Son 24 saatte giriş</span></div>
          <div><strong>{signedIn7d}</strong><span>Son 7 günde giriş</span></div>
          <div><strong>{events.length}</strong><span>Etkinlik</span></div>
          <div><strong>{sharers.size}</strong><span>Fotoğraf paylaşan kişi</span></div>
          <div><strong>{totalUploads}</strong><span>Paylaşılan dosya</span></div>
        </div>
        {unattributedUploads > 0 && (
          <p className={styles.intro}>{unattributedUploads} eski yükleme kişi bilgisi tutulmadığı için kişi sayısına dahil değil.</p>
        )}

        <form className={styles.search} action="/admin/uye">
          <label htmlFor="member-code">Üye koduyla aç (GES-XXXXXXXX) — etkinliklerini görün, düzenleyin veya adına etkinlik oluşturun</label>
          <div>
            <input id="member-code" name="kod" placeholder="GES-1A2B3C4D" required />
            <button type="submit">Üyeyi aç</button>
          </div>
        </form>

        <form className={styles.search} action="/admin">
          <label htmlFor="admin-search">E-posta, kullanıcı adı, kimlik, etkinlik adı veya bağlantıda ara</label>
          <div>
            <input id="admin-search" name="q" defaultValue={Array.isArray(params.q) ? params.q[0] : params.q} />
            <button type="submit">Ara</button>
          </div>
        </form>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Kullanıcılar</h2><span>{filteredUsers.length} sonuç</span>
          </div>
          {filteredUsers.length === 0 ? <p className={styles.empty}>Eşleşen kullanıcı bulunamadı.</p> : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Hesap</th><th>Kayıt</th><th>Etkinlik</th><th>Erişim</th><th>İşlemler</th></tr></thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const email = user.email ?? '(e-posta yok)'
                    const banned = Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now())
                    const isSelf = user.id === currentAdmin.id
                    return (
                      <tr key={user.id}>
                        <td><strong>{names.get(user.id) || email}</strong><small>{email}</small><small className={styles.userId}>{user.id}</small><small><Link href={`/admin/uye?kod=${getMemberCode(user.id)}`}>{getMemberCode(user.id)} · üyeyi aç</Link></small></td>
                        <td>{dateFormatter.format(new Date(user.created_at))}</td>
                        <td>{eventCounts.get(user.id) ?? 0}</td>
                        <td><span className={banned ? styles.locked : styles.active}>{banned ? 'Kilitli' : 'Açık'}</span></td>
                        <td>
                          {isSelf ? <span className={styles.muted}>Yönetici hesabı</span> : (
                            <div className={styles.actions}>
                              <form action={setUserAccess}>
                                <input type="hidden" name="userId" value={user.id} />
                                <input type="hidden" name="action" value={banned ? 'unban' : 'ban'} />
                                <button className={styles.secondary} type="submit">{banned ? 'Kilidi aç' : 'Hesabı kilitle'}</button>
                              </form>
                              <form action={deleteUser} className={styles.deleteForm}>
                                <input type="hidden" name="userId" value={user.id} />
                                <label htmlFor={`delete-user-${user.id}`}>Kalıcı silmek için e-postayı yazın</label>
                                <input id={`delete-user-${user.id}`} name="confirmationEmail" type="email" placeholder={email} required />
                                <button className={styles.danger} type="submit">Kullanıcıyı sil</button>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Etkinlikler</h2><span>{filteredEvents.length} sonuç{events.length === 1000 ? ' · son 1.000 kayıt' : ''}</span>
          </div>
          {filteredEvents.length === 0 ? <p className={styles.empty}>Eşleşen etkinlik bulunamadı.</p> : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Etkinlik</th><th>Sahibi</th><th>Oluşturulma</th><th>Düzenle / sil</th></tr></thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id}>
                      <td><strong>{event.title}</strong><small>{event.event_date} · <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer">etkinlik sayfası ↗</a></small></td>
                      <td>{userById.get(event.owner_id)?.email ?? 'Hesap bulunamadı'}<small>{eventCounts.get(event.owner_id) ?? 0} etkinliği var</small></td>
                      <td>{dateFormatter.format(new Date(event.created_at))}</td>
                      <td>
                        <div className={styles.actions}>
                          <form action={updateEvent} className={styles.editForm}>
                            <input type="hidden" name="eventId" value={event.id} />
                            <label>Ad <input name="title" defaultValue={event.title} maxLength={100} required /></label>
                            <label>Tarih <input name="eventDate" type="date" defaultValue={event.event_date} required /></label>
                            <button className={styles.secondary} type="submit">Kaydet</button>
                          </form>
                          <form action={deleteEvent} className={styles.deleteForm}>
                            <input type="hidden" name="eventId" value={event.id} />
                            <label htmlFor={`delete-event-${event.id}`}>Silmek için ETKİNLİĞİ SİL yazın</label>
                            <input id={`delete-event-${event.id}`} name="confirmation" required />
                            <button className={styles.danger} type="submit">Etkinliği sil</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <p className={styles.warning}>Kalıcı silme işlemleri geri alınamaz. Kullanıcı silme işlemi, o hesaba bağlı etkinlikleri ve uygulama kayıtlarını da silebilir; bu işlem Google Drive’daki dosyaları silmez. Kilitleme, kullanıcının giriş yapmasını engeller.</p>
      </div>
    </main>
  )
}
