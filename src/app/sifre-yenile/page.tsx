import { createClient } from '@/lib/db/server'
import { redirect } from 'next/navigation'
import BrandLogo from '@/components/brand/BrandLogo'
import type { Metadata } from 'next'
import Link from 'next/link'
import UpdatePasswordForm from '@/components/auth/UpdatePasswordForm'
import styles from '@/components/auth/AuthForm.module.css'

export const metadata: Metadata = {
  title: 'Parola yenile',
  description: 'GetEventSnap hesabınıza güvenle erişmek için parolanızı yenileyin.',
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage() {
  const client = await createClient()
  if (!(await client.auth.getUser()).data.user) redirect('/giris')
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a href="/" className={styles.brand} aria-label="Ana sayfaya dön">
          <BrandLogo className={styles.brandLogo} />
        </a>
        <p className={styles.eyebrow}>GÜVENLİ HESAP ERİŞİMİ</p>
        <h1>Yeni parolanızı belirleyin</h1>
        <p className={styles.intro}>Mevcut parolanızı doğrulayarak yeni parolanızı belirleyin.</p>
        <UpdatePasswordForm />
        <p className={styles.switch}><Link href="/giris">Giriş sayfasına dön</Link></p>
      </section>
      <p className={styles.footer}>Anılarınız, sevdiklerinizle daha güzel.</p>
    </main>
  )
}
