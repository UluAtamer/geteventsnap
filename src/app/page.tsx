import BrandLogo from '@/components/brand/BrandLogo'
import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/db/server'
import styles from './home.module.css'

export const metadata: Metadata = {
  title: 'Düğün ve Etkinlik Fotoğrafı Toplama | GetEventSnap',
  description: 'Düğün, nişan, doğum günü ve parti fotoğraf ve videolarını QR kodla toplayın. Misafirler hesap açmadan yüklesin; anılar Google Drive’ınızda biriksin.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Düğün ve Etkinlik Fotoğrafı Toplama | GetEventSnap',
    description: 'Düğün, nişan, doğum günü ve parti fotoğraf ve videolarını QR kodla toplayın. Misafirler hesap açmadan yüklesin; anılar Google Drive’ınızda biriksin.',
    url: '/',
    type: 'website',
  },
}

const steps = [
  {
    number: '01',
    title: 'Etkinlik davetiyenizi hazırlayın',
    description: 'Etkinliğinize isim ve tarih verin. Kapak görselinizi seçin; size özel sayfa ve QR kodu oluşsun.',
    icon: (
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <rect x="13" y="9" width="46" height="54" rx="7" />
        <path d="M24 9V5m24 4V5M13 23h46M24 34h24M24 44h18M24 54h13" />
        <path d="m49 43 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.5 5-.7z" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'QR kodunuzu misafirlerle paylaşın',
    description: 'QR kartını yazdırıp masalara koyun veya etkinlik bağlantısını gönderin. Misafir hesabı gerekmez.',
    icon: (
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <path d="M10 10h20v20H10zM42 10h20v20H42zM10 42h20v20H10z" />
        <path d="M16 16h8v8h-8zM48 16h8v8h-8zM16 48h8v8h-8zM42 42h7v7h-7zM55 42h7v7h-7zM42 55h7v7h-7zM55 55h7v7h-7z" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Fotoğraf ve videolarınızı biriktirin',
    description: 'Misafirler telefondan anılarını gönderir. Dosyalar kendi Google Drive klasörünüze gider.',
    icon: (
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <path d="M22 52h-5a12 12 0 0 1 0-24 18 18 0 0 1 34-6 15 15 0 0 1 5 29h-8" />
        <path d="M36 62V38m-9 9 9-9 9 9" />
      </svg>
    ),
  },
]

const faqs = [
  {
    question: 'Misafirler uygulama indirmek veya hesap açmak zorunda mı?',
    answer: 'Hayır. Telefon kamerasıyla QR kodu okutup etkinlik sayfasını açmaları yeterli. Anı yüklemek için hesap açmaları gerekmez.',
  },
  {
    question: 'Fotoğraflar nerede saklanıyor?',
    answer: 'Fotoğraf ve videolar etkinlik sahibinin Google Drive klasörüne doğrudan yüklenir. Uygulama dosyaların kalıcı kopyasını sunucuda tutmaz.',
  },
  {
    question: 'Misafirler anılarını ne zaman yükleyebilir?',
    answer: 'Yükleme etkinlik günü Türkiye saatiyle 00.00’da açılır ve yedi gün sonra gün sonunda kapanır.',
  },
  {
    question: 'Şu anda paket satın alabilir miyim?',
    answer: 'Şu anki geliştirme sürümünde ödeme alınmıyor. Paket kapsamı ve fiyat bilgileri ödeme aşaması hazır olduğunda açıklanacak.',
  },
]

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  let isLoggedIn = false
  try {
    const database = await createClient()
    const { data } = await database.auth.getSession()
    isLoggedIn = Boolean(data.session)
  } catch {
    isLoggedIn = false
  }

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/" aria-label="GetEventSnap ana sayfa">
          <BrandLogo className={styles.brandLogo} />
        </Link>
        <nav className={styles.navLinks} aria-label="Ana menü">
          <a href="#nasil-calisir">Nasıl çalışır?</a>
          <a href="#paketler">Paketler</a>
          <a href="#sss">Sık sorulanlar</a>
        </nav>
        <div className={styles.navActions}>
          {isLoggedIn ? (
            <Link className={styles.navCta} href="/dashboard">Panele git</Link>
          ) : (
            <>
              <Link className={styles.login} href="/giris">Giriş yap</Link>
              <Link className={styles.navCta} href="/kayit">Hemen başlayın</Link>
            </>
          )}
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>DÜĞÜN, PARTİ VE GÜZEL BULUŞMALAR İÇİN</p>
          <h1>Düğün ve etkinlik fotoğrafları, <em>tek QR kodla.</em></h1>
          <p className={styles.description}>
            Bir QR kod hazırlayın. Sevdikleriniz telefonlarından fotoğraf ve videolarını eklesin.
            Anılarınız doğrudan kendi Google Drive’ınızda biriksin.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/kayit">Ücretsiz hesap oluştur</Link>
            <a className={styles.secondary} href="#nasil-calisir">Nasıl çalıştığını görün <span aria-hidden="true">↓</span></a>
          </div>
          <div className={styles.note}>
            <span className={styles.noteIcon} aria-hidden="true">♡</span>
            <span>Misafirler uygulama indirmeden ve hesap açmadan katılır.</span>
          </div>
        </div>

        <div className={styles.heroArt} aria-label="Etkinliğe özel davetiye ve QR kartı örneği">
          <div className={styles.invitation}>
            <div className={styles.invitationImage} />
            <div className={styles.invitationDetails}>
              <span className={styles.invitationEyebrow}>BİRLİKTE GÜZEL</span>
              <strong>Güzel gününüzün<br />anıları burada</strong>
              <span className={styles.invitationDate}>ETKİNLİĞİNİZE ÖZEL SAYFA</span>
            </div>
          </div>
          <div className={styles.floatingCard}>
            <span className={styles.floatingIcon} aria-hidden="true">▦</span>
            <span><strong>Bir QR kod yeter</strong><small>Telefon kamerasıyla okutun</small></span>
          </div>
          <span className={styles.artFlower} aria-hidden="true">✿</span>
        </div>
      </section>

      <section className={styles.trustStrip} aria-label="Öne çıkan özellikler">
        <div><span aria-hidden="true">✓</span> Hesapsız misafir katılımı</div>
        <div><span aria-hidden="true">✓</span> Dosyalar sizin Drive’ınızda</div>
        <div><span aria-hidden="true">✓</span> Telefonda kolay kullanım</div>
      </section>

      <section className={styles.stepsSection} id="nasil-calisir">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>ÜÇ KOLAY ADIM</p>
          <h2>Misafirleriniz için kolay,<br /><em>sizin için unutulmaz.</em></h2>
          <p>Teknolojiyle arası iyi olmayan misafirleriniz bile büyük QR kodu telefon kamerasıyla okutabilir.</p>
        </div>
        <div className={styles.steps}>
          {steps.map((step) => (
            <article className={styles.step} key={step.number}>
              <div className={styles.stepTop}>
                <span className={styles.stepNumber}>{step.number}</span>
                <span className={styles.stepIcon}>{step.icon}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.privacySection}>
        <div className={styles.privacyArt} aria-hidden="true">
          <div className={styles.driveFolder}><span>▰</span><strong>Bizim anılarımız</strong><small>Google Drive’ınızda</small></div>
          <span className={styles.privacyHeart}>♡</span>
        </div>
        <div className={styles.privacyText}>
          <p className={styles.eyebrow}>ANILARINIZ SİZE AİT</p>
          <h2>Fotoğraflarınız<br />kendi Drive’ınızda.</h2>
          <p>Misafirlerin yüklediği anılar doğrudan sizin Google Drive klasörünüze gider. Dosyalar uygulama sunucusunda kalıcı olarak saklanmaz.</p>
          <ul>
            <li><span aria-hidden="true">✓</span> Drive’ınızda etkinliğe özel klasör</li>
            <li><span aria-hidden="true">✓</span> Misafirlerin dosya indirmesi gerekmez</li>
            <li><span aria-hidden="true">✓</span> İsim ve notlar dosyalarla birlikte saklanır</li>
          </ul>
        </div>
      </section>

      <section className={styles.pricingSection} id="paketler">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>SİZE UYGUN SEÇENEK</p>
          <h2>Her güzel gün için<br /><em>bir GetEventSnap.</em></h2>
          <p>Önce kullanımı kolaylaştırıyoruz. Ödeme ve paket satın alma sonraki aşamada eklenecek.</p>
        </div>
        <div className={styles.plans}>
          <article className={styles.plan}>
            <span className={styles.planLabel}>ŞİMDİ</span>
            <h3>Ödemesiz deneme</h3>
            <p>Uygulamanın mevcut sürümünü deneyin ve etkinlik akışını keşfedin.</p>
            <ul>
              <li>Etkinlik oluşturma paneli</li>
              <li>Özel bağlantı ve QR kartı</li>
              <li>Google Drive’a anı yükleme</li>
            </ul>
            <Link className={styles.planButton} href="/kayit">Hesap oluştur</Link>
          </article>
          <article className={`${styles.plan} ${styles.planFeatured}`}>
            <span className={styles.planLabel}>YAKINDA</span>
            <h3>Tek etkinlik paketi</h3>
            <p>Düğün, doğum günü veya arkadaş buluşması için etkinliğe özel anı sayfası.</p>
            <ul>
              <li>Etkinliğe özel davetiye</li>
              <li>Masaya hazır QR kodu</li>
              <li>Dosyalar kişisel Drive’ınızda</li>
            </ul>
            <span className={styles.planStatus}>Paket ve fiyat bilgisi yakında</span>
          </article>
        </div>
        <p className={styles.pricingNote}>Bu geliştirme sürümünde ödeme alınmıyor. Yakında sunulacak paket ve fiyatlar hazır olduğunda bu sayfada açıklanacak.</p>
      </section>

      <section className={styles.faqSection} id="sss">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>MERAK EDİLENLER</p>
          <h2>Sık sorulan<br /><em>sorular.</em></h2>
        </div>
        <div className={styles.faqList}>
          {faqs.map((faq) => (
            <details className={styles.faq} key={faq.question}>
              <summary>{faq.question}<span aria-hidden="true">+</span></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.contactSection} id="iletisim">
        <div>
          <p className={styles.eyebrow}>BİR SONRAKİ GÜZEL GÜNÜNÜZE</p>
          <h2>Anılarınız şimdiden<br />birikmeye başlasın.</h2>
          <p>Hesabınızı oluşturun, etkinlik sayfanızı hazırlayın ve size özel QR kodunuzu alın.</p>
        </div>
        <Link className={styles.contactButton} href="/kayit">Hemen başlayın <span aria-hidden="true">→</span></Link>
      </section>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/">
          <BrandLogo className={styles.brandLogo} />
        </Link>
        <p>Anılarınız, sevdiklerinizle daha güzel.</p>
        <nav aria-label="Yasal bilgiler">
          <Link href="/gizlilik">Gizlilik ve kişisel veriler (taslak)</Link>
          <Link href="/giris">Hesabınıza giriş yapın</Link>
        </nav>
        <span className={styles.copyright}>© {new Date().getFullYear()} GetEventSnap</span>
      </footer>
    </main>
  )
}

