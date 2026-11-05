import BrandLogo from '@/components/brand/BrandLogo'
import type { Metadata } from 'next'
import Link from 'next/link'
import styles from './privacy.module.css'

export const metadata: Metadata = {
  title: 'Gizlilik ve kişisel veriler',
  description: 'GetEventSnap’te kişisel verilerin kullanımı hakkında bilgilendirme taslağı.',
  robots: { index: false, follow: false },
}

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/">
          <BrandLogo className={styles.brandLogo} />
        </a>
        <Link className={styles.back} href="/">Ana sayfaya dön</Link>
      </header>
      <article className={styles.content}>
        <p className={styles.eyebrow}>GİZLİLİK VE KİŞİSEL VERİLER</p>
        <h1>Gizliliğiniz bizim için önemli.</h1>
        <p className={styles.notice}>
          <strong>Yayın öncesi kontrol edilmesi gereken taslak.</strong>
          Bu bilgilendirme şablonu, hizmeti sunan tüzel kişi bilgileri ve güncel hukuki gereklilikler eklenip uzman incelemesinden geçirilmeden nihai KVKK metni olarak kullanılmamalıdır.
        </p>

        <section>
          <h2>Hangi bilgiler kullanılır?</h2>
          <p>Hesap sahibi için kayıt ve giriş sırasında e-posta adresi kullanılır. Etkinlik sahibi; etkinlik adı, tarihi, türü ve isteğe bağlı kapak görseli ile hoş geldiniz mesajını ekleyebilir.</p>
          <p>Misafirlerin yüklediği fotoğraf ve videolar doğrudan etkinlik sahibinin bağladığı Google Drive hesabına gönderilir. GetEventSnap bu dosyaların kalıcı bir kopyasını kendi sunucusunda saklamaz. Yüklemenin tamamlandığını doğrulamak ve etkinlik panelindeki sayaçları göstermek için dosya kimliği, türü, boyutu ve zamanı gibi sınırlı bilgiler tutulabilir.</p>
        </section>

        <section>
          <h2>Verilerin gizliliği</h2>
          <p>Kullanıcı hesapları, parola özetleri, oturumlar ve etkinlik bilgileri uygulamanın özel PostgreSQL veritabanında tutulur. Parolalar açık metin olarak saklanmaz. Yüklenen özel kapaklar yalnızca hesap sahibinin oturumuyla okunabilir.</p>
          <p>Tanışma isteğe bağlıdır ve 18 yaş ve üzeri katılımcılara açıktır. Takma ad, yaş, fotoğraf ve isteğe bağlı tanıtım yalnızca aynı etkinlikte açık rızayla katılan misafirlere gösterilir. İsteğe bağlı telefon veya Instagram bilgisi yalnızca karşılıklı eşleşmede paylaşılır. Profil sahibi profilini silebilir; engelleme ve etkinlik sahibine bildirme seçenekleri vardır. Profiller, fotoğraflar ve bildirimler etkinlik günü sonrasında temizlenir.</p>
          <p>Misafir sayfasında hesap e-postası, etkinlik adı, adresi, özel kapak veya katılımcı profili yayınlanmaz. Misafirler yalnızca kendi tarayıcı kimlikleriyle yükledikleri dosyalara erişebilir. Etkinlik bağlantısını yalnızca davetlilerinizle paylaşın.</p>
        </section>

        <section>
          <h2>Google Drive ve üçüncü taraf hizmetler</h2>
          <p>Etkinlik sahibi Google Drive’ını bağladığında GetEventSnap, Google’ın izin ekranında belirtilen Drive kapsamını kullanır ve etkinlik klasörünü sahibinin hesabında oluşturur. Google hesabı ve Drive kullanımı Google’ın gizlilik şartlarına da tabidir.</p>
          <p>Kayıt onayı için e-posta adresi ve tek kullanımlık onay bağlantısı yapılandırılmış SMTP hizmetiyle gönderilir. Diğer hesap, veritabanı ve dosya işlemleri uygulama sunucusu ve özel veritabanında yapılır. Google Drive klasörüne uygulama tarafından herkese açık paylaşım izni verilmez.</p>
        </section>

        <section>
          <h2>Haklarınız ve iletişim</h2>
          <p>Yürürlükteki kişisel verilerin korunması mevzuatı kapsamında başvuru, silme ve diğer talepler için veri sorumlusunun unvanı, adresi ve iletişim bilgileri yayına çıkmadan önce bu alana eklenmelidir.</p>
          <p>Bu sayfa bilgilendirme taslağıdır; şirket kimliği, veri saklama süreleri, hizmet sağlayıcı ilişkileri ve başvuru kanalı doğrulanmadan yasal uyum beyanı olarak değerlendirilmemelidir.</p>
        </section>

        <p className={styles.updated}>Son güncelleme: 5 Kasım 2026</p>
        <Link className={styles.primary} href="/kayit">GetEventSnap’i keşfedin</Link>
      </article>
    </main>
  )
}
