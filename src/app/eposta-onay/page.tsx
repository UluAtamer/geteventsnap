import type { Metadata } from 'next'
import Link from 'next/link'
import BrandLogo from '@/components/brand/BrandLogo'
import EmailVerificationForm from '@/components/auth/EmailVerificationForm'
import styles from '@/components/auth/AuthForm.module.css'

export const metadata: Metadata = { title: 'E-posta adresinizi onaylayın', robots: { index: false, follow: false, noarchive: true } }
export default function VerifyEmailPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link href="/" className={styles.brand}><BrandLogo className={styles.brandLogo} /></Link>
        <h1>E-posta adresinizi onaylayın</h1>
        <p className={styles.intro}>Hesabınızı kullanmaya başlamak için e-postanızdaki bağlantıyı açıp onaylayın. Bağlantı 30 dakika geçerlidir.</p>
        <EmailVerificationForm />
        <p className={styles.switch}><Link href="/giris">Giriş sayfasına dön</Link></p>
      </section>
    </main>
  )
}
