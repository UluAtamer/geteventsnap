'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import styles from './AuthForm.module.css'

type AuthFormProps = {
  mode: 'login' | 'signup'
  preview?: boolean
}

export default function AuthForm({ mode, preview = false }: AuthFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignup = mode === 'signup'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (preview) return
    setError('')
    setStatus('')
    setIsSubmitting(true)

    try {
      const database = createClient()

      if (isSignup) {
        const { data, error: signUpError } = await database.auth.signUp({
          email,
          password,
        })

        if (signUpError) {
          setError(signUpError.message)
          return
        }

        if (data.session) {
          router.replace('/dashboard')
          router.refresh()
          return
        }

        setStatus('Hesabınız oluşturuldu. Giriş yapabilirsiniz.')
        return
      }

      const { error: signInError } = await database.auth.signInWithPassword({ email, password })

      if (signInError) {
        setError(signInError.message)
        return
      }

      router.replace('/dashboard')
      router.refresh()
    } catch {
      setError('Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {preview && <p className={styles.status} role="status">Arayüz önizlemesi. Giriş ve kayıt işlemleri canlı ortamda test edilecek.</p>}
      <label className={styles.label} htmlFor={`${mode}-email`}>E-posta adresi</label>
      <input
        className={styles.input}
        id={`${mode}-email`}
        type="email"
        autoComplete="email"
        placeholder="ornek@eposta.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        disabled={preview}
      />
      <label className={styles.label} htmlFor={`${mode}-password`}>Şifre</label>
      <input
        className={styles.input}
        id={`${mode}-password`}
        type="password"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
        placeholder="En az 12 karakter"
        minLength={12}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        disabled={preview}
      />
      {error && <p className={styles.error} role="alert">{error}</p>}
      {status && <p className={styles.status} role="status">{status}</p>}
      <button className={styles.button} type="submit" disabled={isSubmitting || preview}>
        {isSubmitting ? 'Lütfen bekleyin…' : isSignup ? 'Hesap oluştur' : 'Giriş yap'}
      </button>
      {!isSignup && <p className={styles.status}>Parolanızı unuttuysanız sunucu yöneticisinden hesap kurtarma talep edin.</p>}
    </form>
  )
}
