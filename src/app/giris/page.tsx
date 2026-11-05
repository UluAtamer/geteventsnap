import { isEmailVerificationRequired } from '@/lib/email-verification-policy'
import { isUiPreview } from '@/lib/ui-preview'
import BrandLogo from '@/components/brand/BrandLogo'
import type { Metadata } from 'next'
import Link from 'next/link'
import AuthForm from '@/components/auth/AuthForm'
import styles from '@/components/auth/AuthForm.module.css'

export const metadata: Metadata = {
  title: 'Giriş yap',
  description: 'Güvenli şekilde GetEventSnap hesabınıza giriş yapın ve etkinlik anılarınızı yönetin.',
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href="/" className={styles.brand} aria-label="Ana sayfaya dön">
          <BrandLogo className={styles.brandLogo} />
        </a>
        <p className={styles.eyebrow}>ETKİNLİK SAHİBİ</p>
        <h1>Tekrar hoş geldiniz</h1>
        <p className={styles.intro}>Etkinlik anılarınızı yönetmek için hesabınıza giriş yapın.</p>
        <AuthForm mode="login" preview={isUiPreview()} verificationRequired={isEmailVerificationRequired()} />
        <p className={styles.switch}>
          Henüz hesabınız yok mu? <Link href="/kayit">Ücretsiz kayıt olun</Link>
        </p>
      </section>
      <p className={styles.footer}>Anılarınız, sevdiklerinizle daha güzel.</p>
    </main>
  )
}
