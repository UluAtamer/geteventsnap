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
          <p>Etkinlik sahibi Tanışma özelliğini açarsa, katılmayı seçen 18 yaş ve üzerindeki misafirlerin profil bilgileri ve fotoğrafı etkinlik katılımcılarına gösterilebilir. Telefon veya Instagram bilgisi isteğe bağlıdır; yalnızca karşılıklı eşleşme oluşursa diğer kişiyle paylaşılır.</p>
        </section>

        <section>
          <h2>Tanışma profilleri ve silme</h2>
          <p>Tanışma özelliği isteğe bağlıdır ve sadece etkinlik günü kullanılabilir. Profil oluştururken açık rıza onayı istenir. Profil sahibi profilini etkinlik günü kendisi silebilir; bildirilen profili etkinlik sahibi de kaldırabilir.</p>
          <p>Tanışma profilleri, profil fotoğrafları, beğeniler, engellemeler, bildirimler ve eşleşmeler etkinlik günü sona erdikten sonra zamanlanmış temizlik ile silinmek üzere tasarlanmıştır. Bu otomatik görevin üretim ortamında etkin olduğundan emin olmak için Vercel zamanlanmış görev ayarlarının dağıtım sonrası kontrol edilmesi gerekir.</p>
        </section>

        <section>
          <h2>Google Drive ve üçüncü taraf hizmetler</h2>
          <p>Etkinlik sahibi Google Drive’ını bağladığında GetEventSnap, Google’ın izin ekranında belirtilen Drive kapsamını kullanır ve etkinlik klasörünü sahibinin hesabında oluşturur. Google hesabı ve Drive kullanımı Google’ın gizlilik şartlarına da tabidir.</p>
          <p>Uygulama, barındırma ve veritabanı altyapısı için Supabase ve Vercel hizmetlerini kullanabilir. Bu hizmetlerin konumu, saklama koşulları ve veri işleme rolleri gerçek dağıtım yapılandırmasına göre yayın öncesinde bu metinde netleştirilmelidir.</p>
        </section>

        <section>
          <h2>Haklarınız ve iletişim</h2>
          <p>Yürürlükteki kişisel verilerin korunması mevzuatı kapsamında başvuru, silme ve diğer talepler için veri sorumlusunun unvanı, adresi ve iletişim bilgileri yayına çıkmadan önce bu alana eklenmelidir.</p>
          <p>Bu sayfa bilgilendirme taslağıdır; şirket kimliği, veri saklama süreleri, hizmet sağlayıcı ilişkileri ve başvuru kanalı doğrulanmadan yasal uyum beyanı olarak değerlendirilmemelidir.</p>
        </section>

        <p className={styles.updated}>Son güncelleme: 4 Ekim 2026</p>
        <Link className={styles.primary} href="/kayit">GetEventSnap’i keşfedin</Link>
      </article>
    </main>
  )
}
