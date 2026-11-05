'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import styles from './AuthForm.module.css'

export default function UpdatePasswordForm() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 12) {
      setError('Yeni parola en az 12 karakter olmalı.')
      return
    }
    if (password !== confirmation) {
      setError('Parola alanları eşleşmiyor.')
      return
    }

    setIsSubmitting(true)
    try {
      const database = createClient()
      const { error: updateError } = await database.auth.updateUser({ password, currentPassword })
      if (updateError) {
        setError('Parola güncellenemedi. Mevcut parolanızı ve oturumunuzu kontrol edin.')
        return
      }

      router.replace('/dashboard')
      router.refresh()
    } catch {
      setError('Parola güncellenemedi. Lütfen bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.label} htmlFor="current-password">Mevcut parola</label>
      <input className={styles.input} id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} maxLength={128} required />
      <label className={styles.label} htmlFor="new-password">Yeni parola</label>
      <input
        className={styles.input}
        id="new-password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <label className={styles.label} htmlFor="confirm-password">Yeni parola (tekrar)</label>
      <input
        className={styles.input}
        id="confirm-password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        required
      />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.button} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Lütfen bekleyin…' : 'Parolayı güncelle'}
      </button>
    </form>
  )
}
