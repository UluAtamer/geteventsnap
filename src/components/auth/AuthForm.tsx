'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import styles from './AuthForm.module.css'

type AuthFormProps = {
  mode: 'login' | 'signup'
}

function getTurkishError(message: string) {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'E-posta adresi veya şifre hatalı.'
  }
  if (normalizedMessage.includes('email not confirmed')) {
    return 'Devam etmek için e-posta adresinizi doğrulayın.'
  }
  if (normalizedMessage.includes('user already registered')) {
    return 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin.'
  }
  if (normalizedMessage.includes('password') && normalizedMessage.includes('least')) {
    return 'Şifreniz en az 6 karakter olmalı.'
  }
  if (normalizedMessage.includes('rate limit')) {
    return 'Çok fazla deneme yaptınız. Birkaç dakika sonra tekrar deneyin.'
  }

  return 'İşlem tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyin.'
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSignup = mode === 'signup'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setStatus('')
    setIsSubmitting(true)

    try {
      const supabase = createClient()

      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        })

        if (signUpError) {
          setError(getTurkishError(signUpError.message))
          return
        }

        if (data.session) {
          router.replace('/dashboard')
          router.refresh()
          return
        }

        setStatus('Hesabınızı tamamlamak için e-posta adresinize gönderdiğimiz doğrulama bağlantısına tıklayın.')
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError) {
        setError(getTurkishError(signInError.message))
        return
      }

      router.replace('/dashboard')
      router.refresh()
    } catch {
      setError('Supabase bağlantısı kurulamadı. Kurulum ayarlarınızı kontrol edin.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handlePasswordReset() {
    setError('')
    setStatus('')

    if (!email.trim()) {
      setError('Parola yenileme bağlantısı için e-posta adresinizi yazın.')
      return
    }

    setIsSubmitting(true)
    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/sifre-yenile`,
      })

      if (resetError) {
        setError(getTurkishError(resetError.message))
        return
      }

      setStatus('E-posta adresiniz kayıtlıysa parola yenileme bağlantısı gönderildi. Gelen kutunuzu ve gereksiz posta klasörünü kontrol edin.')
    } catch {
      setError('Parola yenileme e-postası gönderilemedi. Lütfen bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
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
      />
      <label className={styles.label} htmlFor={`${mode}-password`}>Şifre</label>
      <input
        className={styles.input}
        id={`${mode}-password`}
        type="password"
        autoComplete={isSignup ? 'new-password' : 'current-password'}
        placeholder="En az 6 karakter"
        minLength={6}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {error && <p className={styles.error} role="alert">{error}</p>}
      {status && <p className={styles.status} role="status">{status}</p>}
      <button className={styles.button} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Lütfen bekleyin…' : isSignup ? 'Hesap oluştur' : 'Giriş yap'}
      </button>
      {!isSignup && (
        <button className={styles.resetLink} type="button" onClick={handlePasswordReset} disabled={isSubmitting}>
          Parolamı unuttum
        </button>
      )}
    </form>
  )
}
