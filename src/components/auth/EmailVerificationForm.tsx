'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import styles from './AuthForm.module.css'

export default function EmailVerificationForm() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (value) {
      setToken(value)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  async function confirm() {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await createClient().auth.verifyEmail(token)
      if (result.error) { setError(result.error.message); return }
      router.replace('/dashboard')
      router.refresh()
    } catch { setError('Onay tamamlanamadı. Lütfen tekrar deneyin.') }
    finally { setBusy(false) }
  }
  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const result = await createClient().auth.resendVerification(email)
      if (result.error) { setError(result.error.message); return }
      setMessage(result.data.message)
    } catch { setError('Bağlantı gönderilemedi. Lütfen tekrar deneyin.') }
    finally { setBusy(false) }
  }
  return (
    <div className={styles.form}>
      {token && <button className={styles.button} type="button" disabled={busy} onClick={confirm}>{busy ? 'Lütfen bekleyin…' : 'E-posta adresimi onayla ve devam et'}</button>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.status} role="status">{message}</p>}
      <form className={styles.form} onSubmit={resend}>
        <p>Bağlantınızın süresi dolduysa veya e-posta gelmediyse yeni bağlantı isteyin.</p>
        <label className={styles.label} htmlFor="verification-email">E-posta adresi</label>
        <input className={styles.input} id="verification-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required />
        <button className={styles.resetLink} type="submit" disabled={busy}>Onay bağlantısını tekrar gönder</button>
      </form>
    </div>
  )
}
