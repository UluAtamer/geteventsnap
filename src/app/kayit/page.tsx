import BrandLogo from '@/components/brand/BrandLogo'
import type { Metadata } from 'next'
import Link from 'next/link'
import AuthForm from '@/components/auth/AuthForm'
import styles from '@/components/auth/AuthForm.module.css'

export const metadata: Metadata = {
  title: 'Hesap oluştur',
  description: 'GetEventSnap hesabınızı oluşturun, etkinliğinize özel sayfa ve QR kod hazırlayın.',
  robots: { index: false, follow: false },
}

export default function RegisterPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href="/" className={styles.brand} aria-label="Ana sayfaya dön">
          <BrandLogo className={styles.brandLogo} />
        </a>
        <p className={styles.eyebrow}>ETKİNLİK SAHİBİ</p>
        <h1>Anılar biriktirmeye başlayın</h1>
        <p className={styles.intro}>Hesabınızı oluşturun; etkinliğinizi sonraki adımda birlikte hazırlayalım.</p>
        <AuthForm mode="signup" />
        <p className={styles.switch}>
          Zaten hesabınız var mı? <Link href="/giris">Giriş yapın</Link>
        </p>
      </section>
      <p className={styles.footer}>Anılarınız, sevdiklerinizle daha güzel.</p>
    </main>
  )
}
