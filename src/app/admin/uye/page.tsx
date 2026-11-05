import Link from 'next/link'
import { requireAdmin } from '@/lib/admin-auth'
import { getMemberCode, normalizeMemberCode } from '@/lib/member-code'
import { createAdminClient } from '@/lib/db/admin'
import { deleteEvent, updateEvent } from '../actions'
import { createEventForMember } from './actions'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

type MemberPageProps = {
  searchParams: Promise<{ kod?: string | string[]; notice?: string | string[] }>
}

const notices: Record<string, string> = {
  event_saved: 'Etkinlik bilgileri güncellendi.',
  event_deleted: 'Etkinlik ve uygulamadaki ilişkili kayıtları silindi. Google Drive’daki dosyalar etkilenmedi.',
  member_event_created: 'Etkinlik üye adına oluşturuldu.',
  confirmation_required: 'İşlem yapılmadı. Onay ifadesini kontrol edip yeniden deneyin.',
  invalid: 'Girilen bilgiler geçersiz; hiçbir değişiklik yapılmadı.',
  event_not_found: 'Etkinlik bulunamadı; hiçbir değişiklik yapılmadı.',
  member_not_found: 'Üye bulunamadı.',
  save_failed: 'Etkinlik kaydedilemedi. Sunucu kayıtlarını kontrol edin.',
  delete_failed: 'Silme işlemi tamamlanamadı. Sunucu kayıtlarını kontrol edin.',
}

export default async function AdminMemberPage({ searchParams }: MemberPageProps) {
  await requireAdmin()
  const params = await searchParams
  const rawCode = Array.isArray(params.kod) ? params.kod[0] : params.kod ?? ''
  const noticeKey = Array.isArray(params.notice) ? params.notice[0] : params.notice
  const code = normalizeMemberCode(rawCode)
  const admin = createAdminClient()

  let member: { id: string; email?: string; created_at: string } | null = null
  if (code) {
    for (let page = 1; page <= 100 && !member; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) throw new Error('Kullanıcı listesi yüklenemedi.')
      member = data.users.find((user) => getMemberCode(user.id) === code) ?? null
      if (data.users.length < 100) break
    }
  }

  const header = (
    <header className={styles.header}>
      <Link className={styles.brand} href="/dashboard">GetEventSnap <span>Yönetim</span></Link>
      <Link className={styles.back} href="/admin">← Yönetim paneline dön</Link>
    </header>
  )

  if (!member) {
    return (
      <main className={styles.page}>
        {header}
        <div className={styles.content}>
          <p className={styles.eyebrow}>ÜYE BULUNAMADI</p>
          <h1>{rawCode ? `“${rawCode}” koduyla üye bulunamadı` : 'Üye kodunu yazın'}</h1>
          <p className={styles.intro}>Kod GES-XXXXXXXX biçimindedir ve üyenin panelinde görünür.</p>
          <MemberLookup defaultValue={rawCode} />
        </div>
      </main>
    )
  }

  const [{ data: profile }, { data: eventRows, error }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', member.id).maybeSingle(),
    admin.from('events').select('id, title, event_date, slug, created_at').eq('owner_id', member.id).order('created_at', { ascending: false }),
  ])
  if (error) {
    console.error('Üye etkinlikleri alınamadı:', error)
    throw new Error('Etkinlikler yüklenemedi.')
  }
  const events = eventRows ?? []
  const memberCode = getMemberCode(member.id)
  const returnTo = `/admin/uye?kod=${memberCode}`
  const dateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' })

  return (
    <main className={styles.page}>
      {header}
      <div className={styles.content}>
        <p className={styles.eyebrow}>ÜYE {memberCode}</p>
        <h1>{profile?.full_name || member.email}</h1>
        <p className={styles.intro}>{member.email} · Kayıt: {dateFormatter.format(new Date(member.created_at))} · {events.length} etkinlik</p>

        {noticeKey && notices[noticeKey] && <p className={styles.notice} role="status">{notices[noticeKey]}</p>}

        <MemberLookup defaultValue={memberCode} />

        <section className={styles.section}>
          <div className={styles.sectionHeading}><h2>Bu üye adına etkinlik oluştur</h2></div>
          <form action={createEventForMember} className={styles.createForm}>
            <input type="hidden" name="ownerId" value={member.id} />
            <label>Etkinlik adı <input name="title" minLength={2} maxLength={100} required /></label>
            <label>Tür
              <select name="event_type" defaultValue="dugun">
                <option value="dugun">Düğün</option>
                <option value="arkadas">Arkadaş buluşması</option>
                <option value="parti">Parti</option>
                <option value="diger">Diğer</option>
              </select>
            </label>
            <label>Tarih <input name="event_date" type="date" required /></label>
            <label>Saat <input name="event_time" type="time" /></label>
            <label>Adres <input name="event_address" maxLength={300} /></label>
            <label>Karşılama mesajı <textarea name="welcome_message" maxLength={500} rows={3} /></label>
            <button className={styles.secondary} type="submit">Etkinliği oluştur</button>
          </form>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><h2>Üyenin etkinlikleri</h2><span>{events.length} sonuç</span></div>
          {events.length === 0 ? <p className={styles.empty}>Bu üyenin henüz etkinliği yok.</p> : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Etkinlik</th><th>Oluşturulma</th><th>Düzenle / sil</th></tr></thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td><strong>{event.title}</strong><small>{event.event_date} · <a href={`/e/${event.slug}`} target="_blank" rel="noreferrer">etkinlik sayfası ↗</a></small></td>
                      <td>{dateFormatter.format(new Date(event.created_at))}</td>
                      <td>
                        <div className={styles.actions}>
                          <form action={updateEvent} className={styles.editForm}>
                            <input type="hidden" name="eventId" value={event.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <label>Ad <input name="title" defaultValue={event.title} maxLength={100} required /></label>
                            <label>Tarih <input name="eventDate" type="date" defaultValue={event.event_date} required /></label>
                            <button className={styles.secondary} type="submit">Kaydet</button>
                          </form>
                          <form action={deleteEvent} className={styles.deleteForm}>
                            <input type="hidden" name="eventId" value={event.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
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
      </div>
    </main>
  )
}

function MemberLookup({ defaultValue }: { defaultValue?: string }) {
  return (
    <form className={styles.search} action="/admin/uye">
      <label htmlFor="member-code">Üye kodu</label>
      <div>
        <input id="member-code" name="kod" defaultValue={defaultValue} placeholder="GES-1A2B3C4D" required />
        <button type="submit">Üyeyi aç</button>
      </div>
    </form>
  )
}
