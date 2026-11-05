# Anıbiriktir

Etkinlikler için QR kodla fotoğraf ve video toplama uygulaması. Bu proje Larosa Çiçek mağazasından bağımsızdır.

## Bilgisayarınızda çalıştırma

Supabase bağlantısı bu bilgisayarda zaten ayarlı. Yeni bir bilgisayara taşırken `.env.example` dosyasını `.env.local` adıyla kopyalayıp kendi Supabase bağlantı bilgilerinizi ekleyin.

### Etkinlik tablosunu bir kez kurma

1. [Supabase SQL Editor'ü açın](https://supabase.com/dashboard/project/tgtazfbdzjmelpidimxe/sql/new).
2. `supabase/migrations/202610040002_events.sql` dosyasını VS Code'da açın.
3. Dosyanın tamamını kopyalayın.
4. Supabase SQL Editor'de yeni sorgu açın, alana yapıştırın ve **Run** düğmesine basın.
5. Aynı şekilde `supabase/migrations/202610040003_public_event_access.sql` dosyasını da yeni bir SQL sorgusunda çalıştırın. Böylece misafirler yalnızca etkinliğin herkese açık bilgilerini görebilir.
6. İlk kez fotoğraflı kapak seçeneği kuruyorsanız `supabase/migrations/202610040004_event_types_and_covers.sql` dosyasını da yeni bir SQL sorgusunda çalıştırın.
7. Google Drive bağlantısı için `supabase/migrations/202610040005_google_drive_connections.sql` dosyasını da yeni bir SQL sorgusunda çalıştırın. Bu tablo şifrelenmiş Drive anahtarını saklar; normal kullanıcılar bu tabloyu okuyamaz.
8. Misafir yüklemesi için `supabase/migrations/202610040006_guest_uploads.sql` dosyasını da yeni bir SQL sorgusunda çalıştırın. Dosya özetleri, hız sınırı ve CSV güncelleme kilidi bu adımda kurulur.
9. Etkinlik panelindeki dosya ve misafir sayaçları için `supabase/migrations/202610040007_dashboard_upload_stats.sql` dosyasını yeni bir SQL sorgusunda çalıştırın.
10. Tanışma profilleri ve güvenli geçici fotoğraflar için `supabase/migrations/202610040008_dating_module.sql` dosyasını yeni bir SQL sorgusunda çalıştırın.
11. Etkinlik adresi ve saati alanlarını eklemek için `supabase/migrations/202610040009_event_location_time.sql` dosyasını da yeni bir SQL sorgusunda çalıştırın.
12. Sorguların sonucunda **Success. No rows returned** yazısını gördüğünüzde kurulum tamamlanmıştır.

### Google Drive bağlantısını kurma

Google Drive bağlantısını her etkinlik sahibi kendi Google hesabıyla yapar. Uygulama yalnızca kendi oluşturduğu Drive dosya ve klasörlerine erişir (`drive.file` izni); Drive'ınızdaki diğer dosyaları taramaz.

#### 1. Google Cloud ayarları

1. [Google Cloud Console](https://console.cloud.google.com/) sayfasını açın ve Google hesabınızla giriş yapın.
2. Üstteki proje menüsünden **New project / Yeni proje** seçeneğiyle bir proje oluşturun veya mevcut projenizi seçin.
3. **APIs & Services / API'ler ve hizmetler → Library / Kitaplık** sayfasına girin.
4. **Google Drive API** aratın, açın ve **Enable / Etkinleştir** düğmesine basın.
5. **Google Auth Platform → Branding / Markalama** bölümünde uygulama adını ve destek e-posta adresini kaydedin.
6. **Audience / Kitle** bölümünde uygulamayı **External / Harici** olarak ayarlayın. **Testing / Test** durumunda yalnızca **Test users / Test kullanıcıları** listesine eklediğiniz hesaplar bağlanabilir. Herkesin kullanabilmesi için kurulumu tamamladıktan sonra **Publish app / Uygulamayı yayınla** ile durumu **In production / Üretimde** yapın.
7. **Data Access / Veri erişimi** bölümünde şu kapsamı ekleyin: `https://www.googleapis.com/auth/drive.file`
8. **Clients / İstemciler → Create client / İstemci oluştur** seçin; uygulama türü **Web application / Web uygulaması** olsun.
9. **Authorized JavaScript origins / Yetkili JavaScript kaynakları** listesine `http://localhost:3002` ekleyin. Bu alana yalnızca site adresini yazın; `/api/google/drive/callback` yolunu eklemeyin. Tarayıcının Drive'a doğrudan dosya gönderebilmesi için bu kaynak gereklidir.
10. **Authorized redirect URIs / Yetkili yönlendirme URI'leri** listesine birebir şu adresi ekleyin: `http://localhost:3002/api/google/drive/callback`
11. Google Cloud'da sunucuda `GOOGLE_CLIENT_ID` için kullandığınız **Web application** istemcisini açın. JavaScript kaynaklarına `https://www.geteventsnap.com`, yönlendirme URI'lerine birebir `https://www.geteventsnap.com/api/google/drive/callback` ekleyin. Üretim uygulaması bu callback adresini sabit kullanır; Google Cloud'da başka bir istemciye veya `geteventsnap.com` (www olmadan) adresine eklemek yeterli değildir. Yerel geliştirmede `GOOGLE_REDIRECT_URI` `.env.local` içindeki localhost callback adresi olmalıdır.
12. Oluşturduğunuz istemcinin **Client ID** ve **Client secret** değerlerini kopyalayın. Bu değerleri kimseyle paylaşmayın.

#### 2. Uygulama anahtarları

1. VS Code'da proje klasöründeki `.env.local` dosyasını açın. Bu dosya gizlidir ve Git'e eklenmez. Dosya yoksa `.env.example` dosyasının bir kopyasını `.env.local` adıyla oluşturun.
2. Google Cloud'dan aldığınız değerleri `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` satırlarına yapıştırın.
3. `GOOGLE_REDIRECT_URI` satırının Google Cloud'da eklediğiniz adresle aynı olduğundan emin olun.
4. Supabase panelinde **Project Settings / Proje ayarları → API Keys / API anahtarları** bölümünü açın ve **secret** sunucu anahtarını `SUPABASE_SERVICE_ROLE_KEY` satırına yapıştırın. Bu güçlü anahtar yalnızca sunucuda kullanılmalıdır; adının önüne `NEXT_PUBLIC_` eklemeyin, web sayfasında paylaşmayın.
5. Yeni bir PowerShell penceresinde aşağıdaki komutu çalıştırın ve çıkan tek satırı `DRIVE_TOKEN_ENCRYPTION_KEY` değerine yapıştırın:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
6. Fotoğraf ve video boyut sınırlarını değiştirmek isterseniz `GUEST_MAX_PHOTO_BYTES` ve `GUEST_MAX_VIDEO_BYTES` değerlerini `.env.local` dosyasına ekleyin. Varsayılan sınırlar fotoğraf için 25 MB, video için 500 MB'dır.
7. `.env.local` dosyasını kaydedin. Çalışan geliştirme sunucusunu **Ctrl+C** ile durdurup proje klasöründe `npm run dev -- --port 3002` komutuyla yeniden başlatın.

#### 3. Uygulamayı herkese açma

Sitenin her kullanıcısının Drive'ını bağlayabilmesi için Google Auth Platform → **Audience / Kitle** bölümünde **Publish app / Uygulamayı yayınla** düğmesine basıp durumu **In production / Üretimde** yapın. Test durumunda kullanıcıları tek tek **Test users / Test kullanıcıları** listesine eklemek gerekir; bu kısıtlama uygulama kodundan kaldırılamaz. Bu uygulama yalnızca `drive.file` kapsamını ister; Google Cloud **Data Access / Veri erişimi** sayfasında kapsam sınıflandırmasını kontrol edin. Google, seçilen kapsam veya gösterilecek marka bilgileri için ayrıca doğrulama isteyebilir; yalnızca Google'ın Console'da istediği doğrulama adımlarını tamamlayın.

Üretime almak, Google Workspace yöneticisinin kuruluşu için koyduğu üçüncü taraf uygulama kısıtlamalarını kaldırmaz. Bir kullanıcının kuruluşu uygulamayı engelliyorsa, yalnızca o kuruluşun yöneticisi erişime izin verebilir; bu politika atlanamaz. Uygulamayı herkese açmak test kullanıcısı kısıtlamasını kaldırır ama kullanıcıların kendi Drive'larına bağlanırken Google izin ekranında **İzin ver** demesi yine zorunludur; güvenlik onayı atlanamaz.

#### 4. Destek e-postasını değiştirme

Google izin ekranındaki **Developer info / Geliştirici bilgileri** bölümünde görünen destek e-postası uygulama kodundan değil, Google Auth Platform → **Branding / Markalama → User support email / Kullanıcı destek e-postası** ayarından gelir. Burada kullanıcılara göstermek istediğiniz, takip ettiğiniz genel destek adresini seçip kaydedin. Google seçeneklerinde yönetebildiğiniz bir Google Group adresi veya proje sahibi Google hesabı kullanılabilir. Yeni bir adres listede görünmüyorsa Branding sayfasındaki Google koşullarını izleyin; örneğin grubu yönetin veya ilgili Google hesabını projeye ekleyip o hesapla oturum açın.

### Etkinlik oluşturma

1. Uygulamada [giriş sayfasını](http://localhost:3002/giris) açın.
2. Kayıt sırasında kullandığınız e-posta ve şifreyle giriş yapın.
3. Panelde **Etkinlik oluştur** düğmesine basın.
4. Düğün, arkadaş buluşması, parti veya diğer etkinlik türlerinden birini seçin. İsim ve tarihi girin; hoş geldiniz mesajı isteğe bağlıdır.
5. Etkinlik türüne uygun hazır kapaklardan birini kullanabilir veya **Telefondan fotoğraf seç** düğmesiyle JPEG, PNG ya da WebP biçimindeki en fazla 5 MB fotoğrafınızı ekleyebilirsiniz.
6. **Etkinliği oluştur** düğmesine basın. Bağlantı, indirilebilir QR kodu ve yazdırılabilir masa kartı etkinlik kartında görünür.
7. Etkinlik bağlantısını açın. Misafir yükleme alanı etkinlik gününe kadar kapalı görünür; yükleme tarihleri Europe/Istanbul saat dilimine göre hesaplanır.

Etkinlik kartındaki **Google Drive'ı bağla** düğmesiyle Google hesabınızı bağlayın. İzin verdikten sonra Drive'ınızda etkinlik adıyla `- Anılar` ekini taşıyan klasör oluşur; panelde **Drive klasörünü aç** bağlantısı görünür.

### Etkinlik sahibi paneli

Her etkinlik kartında etkinlik durumu, başarıyla yüklenen dosya sayısı, yükleme yapan farklı tarayıcıların sayısı ve Tanışma ayarı görünür. Misafir sayacı için tarayıcıda rastgele bir kimlik oluşturulur; veritabanında yalnızca etkinliğe özel anahtarlı özeti tutulur. Ad veya e-posta bu sayaç için kaydedilmez. Henüz yükleme yapmayan misafirler sayılmaz.

Drive bağlantısı yenileme gerektirirse kartta uyarı ve yeniden bağlanma düğmesi görünür. E-posta uyarısı şimdilik etkin değildir; e-posta sağlayıcısı dağıtım aşamasında seçilip yapılandırılacaktır. Tanışma anahtarı açılırsa misafirler etkinlik gününde profillerini oluşturabilir. Etkinlik sahibi, bildirilen profilleri etkinlik kartındaki düğmeden inceleyebilir.

### Tanıtım sayfası

Ana sayfada Anıbiriktir’in nasıl çalıştığı, örnek etkinlik davetiyesi, Google Drive ve gizlilik bilgileri, paket taslakları ve sık sorulan sorular bulunur. Ödeme henüz alınmadığı için paket fiyatları açıklanmaz; destek e-posta adresi de gerçek yayına çıkmadan önce eklenecektir. Gizlilik sayfası hukuki inceleme gerektiren bir taslaktır, tamamlanmış KVKK metni değildir.

### Etkinlik davetiyesi ve misafirler için kolay kullanım

Etkinlik oluştururken isteğe bağlı saat ve adres ekleyebilirsiniz. Saat davetiyede gösterilir; adres varsa misafir sayfasında ve sahip panelinde **Adrese git** düğmesi görünür ve haritada arama açılır. QR kartının yazdırılan bölümünde etkinlik adı, QR kodu, saat ve adres görünür; harita düğmesi yazdırma alanının dışındadır. Misafir sayfasında doğrudan anı yükleme alanı açılır; kullanım adımları tanıtım sayfasındaki “Nasıl çalışır?” bölümünde anlatılır.

### 6. aşama: Tanışma modülü

1. Supabase SQL Editor'de `supabase/migrations/202610040008_dating_module.sql` dosyasının tamamını ayrı ve boş bir sorguya yapıştırıp **Run** düğmesine basın. Sorgu, herkese açık etkinlik bilgisini Tanışma ayarıyla günceller; Tanışma tablolarını ve özel profil fotoğrafı alanını kurar.
2. Etkinlik sahibi panelinde istediğiniz etkinliğin **Tanışma** anahtarını açın.
3. Misafir bağlantısında Tanışma bölümü etkinlik günü açılır. Katılmak isteyen kişi 18 yaşını doğrular, fotoğraf seçer ve açık rıza kutusunu işaretler. Telefon/Instagram bilgisi isteğe bağlıdır ve yalnızca karşılıklı eşleşmede gösterilir.
4. Profil kartlarında **Beğen** veya **Geç** seçilir. Karşılıklı beğeni eşleşme oluşturur. Misafir profili bildirebilir, engelleyebilir veya kendi profilini silebilir.
5. Etkinlik sahibi, etkinlik kartındaki **Bildirilen profilleri incele** düğmesinden bildirimi kapatabilir veya profili ve fotoğrafını kaldırabilir.

#### Etkinlik günü verilerinin otomatik silinmesi

Profil, fotoğraf, beğeni, engel, bildirim ve eşleşmeler etkinlik günü sonrasında otomatik temizlenir. Ziyaretçi API'leri Tanışma'yı etkinlik günü dışındaki saatlerde zaten kapalı tutar; Vercel zamanlanmış görevi her gün Türkiye saatiyle 00.05'te önceki günün verilerini siler. Bu görev, Vercel'e dağıtım yapılınca çalışır.

1. Bilgisayarınızda yeni bir PowerShell penceresi açıp şu komutu çalıştırın:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Çıkan uzun değeri proje klasöründeki `.env.local` dosyasına `CRON_SECRET=...` olarak ekleyin. Bu dosyayı kimseyle paylaşmayın.
3. Uygulamayı Vercel'e dağıttığınızda, Vercel projesini açın: **Settings → Environment Variables → Add New**. `CRON_SECRET` adıyla aynı değeri ekleyin ve **Production** ortamını seçip kaydedin.
4. Vercel proje kökündeki `vercel.json` dosyası zamanlamayı tanımlar. Vercel dağıtımından sonra **Settings → Cron Jobs** bölümünde `/api/cron/dating-cleanup` görevini ve günlük zamanlamayı kontrol edin.

`CRON_SECRET` olmadan temizleme adresi çalışmaz. Bu gizli değeri tarayıcı koduna eklemeyin veya başkalarıyla paylaşmayın.

### Misafir fotoğraf ve video yüklemesi

1. Etkinlik sahibi önce panelde Google Drive'ı bağlamalıdır.
2. Misafir, etkinliğin `/e/...` bağlantısını veya QR kodunu telefonunda açar.
3. Yükleme etkinlik günü saat 00.00'da açılır ve Europe/Istanbul saatine göre 7 gün sonraki günün sonuna kadar sürer. Süre dışında ekranda uygun açıklama görünür; sunucu da yüklemeyi reddeder.
4. Misafir isim ve soyisim yazar veya **Anonim ekle** seçeneğini işaretler. Birden fazla fotoğraf/video seçebilir ve telefondaki **Kamerayla çek** düğmesini kullanabilir. İsteğe bağlı not en fazla 300 karakterdir.
5. Yükleme ilerlemesi ekranda gösterilir. Bağlantı kesilirse aynı dosya için **Tekrar dene** seçilebilir.
6. Dosyanın kendisi sunucuya gönderilmez: tarayıcı Google Drive'ın resumable upload oturumuna doğrudan aktarır. Sunucuda yalnızca Drive dosya kimliği, boyut, tür ve yüklenme zamanı gibi özet bilgiler saklanır. Hız sınırı için IP adresinin anahtarlı özeti etkinlik bazında tutulur ve bir günden eski kayıtlar temizlenir; ham IP adresi saklanmaz.
7. Dosya adı etkinlik tarihi ve misafir adıyla oluşturulur. İsim ve not Drive dosyasının açıklamasına yazılır ve etkinlik klasöründeki `notlar.csv` dosyasına eklenir.

Uygulama başlamadıysa terminalde proje klasörüne girip `npm run dev -- --port 3002` komutunu çalıştırın, ardından `http://localhost:3002` adresini açın.

Kayıt ve giriş ekranları sırasıyla `/kayit` ve `/giris` adreslerindedir. Giriş yapmış kullanıcılar `/dashboard` ekranını görür. `.env.local` dosyasını paylaşmayın; Supabase sunucu anahtarını hiçbir zaman tarayıcıya koymayın.
