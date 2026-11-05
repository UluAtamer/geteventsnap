'use client'

import { useState } from 'react'
import styles from './DatingReportsManager.module.css'

type Report = {
  id: string
  reason: string
  createdAt: string
  profile: { id: string; name: string; age: number; photoUrl: string } | null
}

type DatingReportsManagerProps = {
  eventId: string
}

export default function DatingReportsManager({ eventId }: DatingReportsManagerProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<Report[]>([])

  async function loadReports() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/dashboard/dating/reports?eventId=${encodeURIComponent(eventId)}`)
      const body = await response.json() as { reports?: Report[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Bildirimler yüklenemedi.')
      setReports(body.reports ?? [])
      setOpen(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Bildirimler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  async function processReport(report: Report, action: 'dismiss' | 'remove') {
    const confirmation = action === 'remove'
      ? `${report.profile?.name ?? 'Bildirilen'} adlı kişinin profili ve fotoğrafı silinsin mi?`
      : 'Bu bildirimi incelendi olarak kapatmak istiyor musunuz?'
    if (!window.confirm(confirmation)) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/dashboard/dating/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId, reportId: report.id, action }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Bildirim işlenemedi.')
      setReports((current) => current.filter((item) => item.id !== report.id))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Bildirim işlenemedi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={styles.manager}>
      <button className={styles.openButton} type="button" onClick={loadReports} disabled={loading}>
        {loading ? 'Bildirimler yükleniyor…' : `Bildirilen profilleri incele${reports.length ? ` (${reports.length})` : ''}`}
      </button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {open && (
        <div className={styles.list}>
          <div className={styles.heading}>
            <h3>Misafir bildirimleri</h3>
            <button className={styles.closeButton} type="button" onClick={() => setOpen(false)}>Kapat</button>
          </div>
          {reports.length === 0 ? (
            <p className={styles.empty}>Bekleyen bildirim yok.</p>
          ) : reports.map((report) => (
            <article className={styles.report} key={report.id}>
              {report.profile
                ? <img src={report.profile.photoUrl} alt="" />
                : <span className={styles.removed}>Silinmiş profil</span>}
              <div className={styles.reportText}>
                <strong>{report.profile ? `${report.profile.name}, ${report.profile.age}` : 'Profil kaldırılmış'}</strong>
                <span>{report.reason}</span>
                <time dateTime={report.createdAt}>
                  {new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(report.createdAt))}
                </time>
              </div>
              <div className={styles.actions}>
                {report.profile && (
                  <button type="button" onClick={() => processReport(report, 'remove')} disabled={loading}>Profili kaldır</button>
                )}
                <button type="button" onClick={() => processReport(report, 'dismiss')} disabled={loading}>İncelendi</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
