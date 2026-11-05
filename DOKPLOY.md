# GetEventSnap — Dokploy yükleme rehberi

Bu rehber, uygulamayı **Dockerfile** ile, Dokploy’daki ayrı bir **PostgreSQL** servisine bağlayarak yayınlar. Gizli değerler Dokploy Environment’ta tutulur. Kayıt onay e-postaları için ayrıca SMTP hesabı gerekir. Yerel önizleme modu üretimde kullanılmaz.

## 1. Güncel kodu depoya gönder

Dokploy’un kullanacağı Git dalında şu dosyaların bulunduğunu kontrol et:

- `Dockerfile`, `.dockerignore`, `package.json`, `package-lock.json`
- `next.config.ts`, `src/`, `public/`
- `db/migrations/001_initial.sql`
- `scripts/migrate.mjs`, `scripts/validate-env.mjs`, `scripts/docker-entrypoint.sh`

Yereldeki değişiklikler henüz gönderilmediyse kendi Git akışınla commit ve push yap. `.env.local` dosyasını gönderme; içindeki yerel PostgreSQL bilgilerini üretime kopyalama.

## 2. PostgreSQL servisini oluştur

Dokploy’da proje oluştur veya mevcut projeyi aç. Proje içinde yeni bir **PostgreSQL** veritabanı servisi oluştur:

| Alan | Değer |
| --- | --- |
| Servis adı | `eventsnap-db` gibi bir ad |
| Veritabanı adı | `eventsnap` |
| Kullanıcı | Bu uygulamaya özel bir kullanıcı |
| Parola | Güçlü ve benzersiz bir parola |
| External Port | Boş |

Veritabanını **Deploy** et. Hazır olduğunda bağlantı bilgilerindeki **Internal Connection URL** değerini kopyala. Uygulamanın `DATABASE_URL` değeri bu olacak. URL’yi elle kurmak yerine panelin verdiği tam değeri kullan.

Uygulama ve veritabanı aynı dahili ağdan erişilebilir olmalı. Dokploy’un kendi sistem veritabanını kullanma. Dahili bağlantı için veritabanını internete açmak gerekmez. [Dokploy bağlantı belgesi](https://docs.dokploy.com/docs/core/databases/connection)

## 3. Uygulamayı oluştur ve Git deposunu bağla

Aynı projede yeni bir **Application** oluştur. Git sağlayıcını, bu projenin deposunu ve yayınlayacağın dalı seç. Özel depo kullanıyorsan Dokploy’a o depoyu okuma erişimi ver.

Build ayarları:

| Ayar | Değer |
| --- | --- |
| Build Type | `Dockerfile` |
| Dockerfile Path | `Dockerfile` |
| Build Context | `.` — depo kökü |
| Container Port | `3000` |
| Özel Build/Start Command | Boş; Dockerfile ve entrypoint yönetir |

Panelde Build Path ayrı bir alan olarak görünüyorsa depo kökünü seç. Bu yöntem için `compose.yaml` seçmen gerekmez. [Dockerfile build türü](https://docs.dokploy.com/docs/core/applications/build-type)

## 4. Alan adı ve HTTPS ayarla

Kullanacağın tek ana adresi belirle. Örneğin `https://etkinlik.example.com`.

1. DNS sağlayıcında alan adını sunucunun IP adresine yönlendir.
2. Uygulamanın **Domains** bölümünde domain oluştur.
3. Host alanına yalnızca alan adını yaz: `etkinlik.example.com`.
4. Path: `/`, Container Port: `3000` seç.
5. HTTPS’i etkinleştir ve uygun sertifikayı, örneğin **Let’s Encrypt**, seç.

Domains bölümündeki container portu Traefik yönlendirmesi içindir. **Advanced → Ports** üzerinden ayrıca 3000 portunu yayınlama. [Dokploy domain ayarları](https://docs.dokploy.com/docs/core/domains/others)

`www` veya alt alan adı kullanacaksan sonraki bütün adreslerde aynı kaynağı kullan. `SITE_URL`, Google OAuth adresleri ve tarayıcıda açtığın adres eşleşmeli.

## 5. Google Drive OAuth bilgilerini hazırla

Google Cloud projesinde Drive API’yi etkinleştir ve bir OAuth **Web application** istemcisi oluştur. İzin kapsamı:

```text
https://www.googleapis.com/auth/drive.file
```

Örnek alan adına göre istemci ayarları:

| Alan | Değer |
| --- | --- |
| Authorized JavaScript origins | `https://etkinlik.example.com` |
| Authorized redirect URIs | `https://etkinlik.example.com/api/google/drive/callback` |

Client ID ve Client Secret değerlerini al. Google izin ekranındaki test/yayın durumuna göre kullanacağın hesabın erişimini de ayarla. Bu değerleri Git’e ekleme.

## 6. Dokploy Environment değerlerini gir

Uygulamanın **Environment** bölümüne aşağıdaki şablonu ekle. Köşeli açıklamaları kendi değerlerinle değiştir:

```dotenv
DATABASE_URL=<Dokploy PostgreSQL Internal Connection URL>
DATABASE_POOL_MAX=10
SITE_URL=https://etkinlik.example.com
GOOGLE_CLIENT_ID=<Google Client ID>
GOOGLE_CLIENT_SECRET=<Google Client Secret>
GOOGLE_REDIRECT_URI=https://etkinlik.example.com/api/google/drive/callback
ADMIN_USER_ID=
GUEST_MAX_PHOTO_BYTES=26214400
GUEST_MAX_VIDEO_BYTES=524288000
SMTP_HOST=<e-posta sağlayıcının SMTP sunucusu>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<SMTP kullanıcı adı>
SMTP_PASSWORD=<SMTP parolası>
SMTP_FROM=<gönderici e-posta adresi>
```

Ayrı bir Drive şifreleme anahtarı üretmen gerekmez. Kullanıcı token’ları `GOOGLE_CLIENT_SECRET` değerinden türetilen anahtarla şifreli tutulur. Google istemci sırrı değiştirilirse kullanıcılar Drive’larını yeniden bağlamalıdır. Önceki sürümde bağlanan hesaplar bu güncellemede yeniden yetkilendirme ister; mevcut Drive klasörleri korunur.

- Değerler **runtime environment** olarak container’a aktarılmalı; build argument olarak verilmemeli.
- `SITE_URL` HTTPS kaynağı olmalı; sonuna sayfa yolu veya `:3000` ekleme.
- `GOOGLE_REDIRECT_URI` istersen boş kalabilir; uygulama `SITE_URL` üzerinden üretir. Doluysa yukarıdaki callback adresiyle birebir aynı olmalı.
- `ADMIN_USER_ID` ilk kurulumda boş kalabilir.
- `LOCAL_UI_PREVIEW`, `LOCAL_POSTGRES_PASSWORD` ve `NEXT_PUBLIC_` anahtarları ekleme.
- `NODE_ENV=production`, `PORT=3000` ve `HOSTNAME=0.0.0.0` Dockerfile’da zaten ayarlı.

Environment değişikliklerini kaydet. Sonraki değişikliklerde yeni değerlerin uygulanması için yeniden deploy et.

## Kayıt onay e-postalarını etkinleştir

SMTP bilgilerini e-posta sağlayıcının panelinden al. `SMTP_FROM` alanına sadece e-posta adresini yaz; uygulama gönderici adını GetEventSnap olarak ekler. Port 465 için `SMTP_SECURE=true`, port 587 için `SMTP_SECURE=false` kullan; ikinci durumda STARTTLS zorunludur. Sunucunun seçilen SMTP portuna dışarı bağlantı kurabilmesi gerekir. SPF ve DKIM kayıtlarını e-posta sağlayıcının verdiği değerlerle ayarla. [Nodemailer SMTP belgesi](https://nodemailer.com/smtp)

SMTP bilgileri eksik olduğunda web sunucusu durmaz; yeni kayıt ve onay gönderimi kapalı kalır. Dolu fakat hatalı bilgilerde kayıt ekranında gönderim hatası görünür; loglarda SMTP parolası veya onay bağlantısı yazdırılmaz.

Kayıt testi: `/kayit` üzerinden yeni bir adresle kayıt ol. Onay öncesinde oturum açılmamalı. Gelen e-postadaki bağlantıyı açıp **E-posta adresimi onayla ve devam et** düğmesine bas; ardından panel açılmalı. Kullanılmış bağlantı yeniden kabul edilmemeli. E-posta gelmezse giriş/kayıt ekranındaki **Onay e-postasını tekrar gönder** bağlantısını kullan. Onay bağlantıları 30 dakika geçerlidir; tekrar gönderme dakikada bir ve saatte en fazla beş kez yapılır.

Önceki normal kullanıcıların da e-postalarını onaylaması gerekir; eski oturumları geçersizleşir. Mevcut yöneticiler ve operatörün seed hesapları korunur.

## İlk deploy için geçici kullanıcı

İlk deployda kullanıcı oluşturmak için Dokploy Environment’a ekle:

```dotenv
SEED_USER_ENABLED=true
SEED_USER_EMAIL=<girişte kullanacağın e-posta>
SEED_USER_PASSWORD=<12–128 karakterlik geçici parola>
```

Parolayı Dokploy’da belirle; kaynak koda ekleme. Container başlangıcında migration’dan sonra hesap oluşturulur. Aynı e-postayla hesap zaten varsa parolası değiştirilmez. Hesabın yönetici olmasını istiyorsan ayrıca `SEED_USER_IS_ADMIN=true` ekle. Rol veritabanında saklanır; seed kapatılınca korunur. Mevcut normal hesabı yöneticiye yükseltirken `SEED_USER_PASSWORD` mevcut parolasıyla eşleşmeli.

Deploydan sonra `/giris` üzerinden bu bilgilerle giriş yap. Paneldeki **Parola değiştir** bağlantısından mevcut parolayı ve yeni parolanı gir. Değişiklik eski oturumları iptal eder.

Ardından `SEED_USER_ENABLED=false` yap, `SEED_USER_EMAIL` ve `SEED_USER_PASSWORD` değerlerini Dokploy’dan sil ve yeniden deploy et. Hesap ve yeni parolası korunur. İşlem tamamlanınca `SEED_USER_IS_ADMIN` değişkenini de kaldır. Seed’i kapatmak hesabı silmez; geçici hesabı tamamen kaldırmak istersen yetkili yönetim panelinden ayrıca silmelisin.

## 7. Deploy et

Uygulamada **Deploy** düğmesine bas ve build/deployment loglarını izle.

Başlangıç sırası:

1. Docker imajı derlenir. Bu aşamada veritabanı bağlantısı ve gizli değer gerekmez.
2. Container runtime environment değerlerini doğrular.
3. Migration’lar PostgreSQL üzerinde uygulanır. İlk kurulumda `Migration uygulandı: 001_initial.sql` satırı görülür.
4. Next.js sunucusu 3000 portunda başlar.

Container çalışma logunda her başarılı başlangıçta, yeni migration olmasa da, şu mesajlar görünür:

```text
[Başlangıç] Environment ayarları doğrulandı.
[Veritabanı] PostgreSQL bağlantısı kuruluyor...
[Veritabanı] PostgreSQL bağlantısı başarıyla kuruldu.
[Veritabanı] Şema kontrolü tamamlandı; veritabanı hazır.
[Başlangıç] Web sunucusu başlatılıyor.
```

Bağlantı başarı mesajı gerçek bir `SELECT 1` sorgusundan sonra yazılır. Bağlantı adresi, kullanıcı adı ve parola loglanmaz. Environment doğrulaması başarısızsa veritabanı aşamasına geçilmez; ilk hata mesajını kontrol et. Bu mesajlar Docker build sırasında değil container çalışmaya başladığında görünür.

Migration’ları SQL paneline elle yapıştırman gerekmez. Uygulanmış migration dosyalarını değiştirme; sonraki şema değişiklikleri yeni dosyayla yapılır. Veritabanı veya zorunlu environment ayarları hazır değilse uygulama başlamaz.

## 8. Canlı kontrol yap

Alan adında şu adresi aç:

```text
https://etkinlik.example.com/api/health
```

Beklenen yanıt:

```json
{"status":"ok"}
```

Ardından:

1. `/kayit` üzerinden kendi hesabını oluştur ve gelen e-postadaki bağlantıdan onayla.
2. Çıkış yapıp `/giris` üzerinden yeniden giriş yap.
3. `/dashboard` içinde etkinlik oluştur.
4. Google Drive bağlantısını başlat ve kendi hesabınla izin ver.
5. Etkinlik bağlantısını gizli pencerede aç. Hesap e-postası, etkinlik adı, adres ve özel kapak görünmemeli.
6. Yükleme dönemi açık bir etkinlikte deneme dosyası yükle ve özel Drive klasöründe oluştuğunu kontrol et.
7. Başka bir tarayıcıdan ilk misafirin yüklediği dosyaların listelenmediğini doğrula.

Üretimde önizleme modu bulunmaz; giriş/kayıt gerçek PostgreSQL veritabanını kullanır.

## 9. Yönetici panelini görünür yap

Seed hesabınla yönetim panelini kullanmak için aşağıdakileri Dokploy Environment’a ekle ve yeniden deploy et:

```dotenv
SEED_USER_ENABLED=true
SEED_USER_IS_ADMIN=true
SEED_USER_EMAIL=<seed hesabının e-postası>
SEED_USER_PASSWORD=<hesabın şu anki parolası>
```

Deploydan sonra `/dashboard` üst menüsünde **Yönetim paneli** görünür. `/admin` doğrudan da açılabilir. Sonrasında `SEED_USER_ENABLED=false` yapıp diğer üç seed değişkenini kaldır; yönetici rolü korunur. Normal üyeler yönetim paneline erişemez.

Alternatif olarak mevcut bir hesabı UUID üzerinden yetkilendirebilirsin:


Kendi hesabına giriş yaptıktan sonra aynı tarayıcıda `/api/auth/user` adresini aç. Yanıttaki `data.user.id` değerini al. Bu uç nokta yalnızca mevcut oturumun kullanıcısını döndürür.

Dokploy Environment’ta `ADMIN_USER_ID` değerine bu UUID’yi yazıp yeniden deploy et. Aynı hesapla giriş yapınca `/admin` erişimi açılır. E-posta adresi veya üye kodu bu alana yazılmaz.

## Tanışma özelliği

Güncel kodu deploy edince `005_restore_dating.sql` otomatik uygulanır. Etkinlik sahibi `/dashboard` içinden **Tanışma → Aç** düğmesine basar. Misafirler o etkinliğin QR sayfasından 18 yaş ve açık rıza onayıyla profil oluşturabilir. Özellik yalnızca etkinlik günü Türkiye saatine göre çalışır; yeni etkinliklerde kapalıdır.

Profil/fotoğraf erişimi aynı etkinlikteki katılımcı oturumlarıyla sınırlıdır; iletişim bilgileri karşılıklı eşleşmede açılır. Etkinlik sahibi panelde **Bildirilen profilleri incele** bölümünden moderasyon yapabilir. Docker içindeki temizlik işlemi gün sonrasında profil, fotoğraf ve bildirimleri her dakika kontrol ederek siler. Ek bir zamanlayıcı veya environment anahtarı gerekmez.

Canlı testte iki ayrı tarayıcı profiliyle katıl, karşılıklı beğeniyle eşleşmeyi kontrol et. Oturumsuz fotoğraf isteği reddedilmeli; engellemeden sonra karşı tarafın fotoğrafı ve iletişim bilgileri erişilememeli.

## 10. Verileri koru ve güncelle

Uygulamanın kalıcı verileri PostgreSQL’de, misafir fotoğraf/videoları Google Drive’da tutulur. Uygulama container’ı için ayrıca kalıcı volume gerekmez. PostgreSQL servisi için kalıcı disk ve özel erişimli yedekleme ayarlarını koru.

Güncellemede kodu bağlı dala gönderip yeniden deploy et. Veritabanı servisini veya veritabanı volume’unu silme. Eski sistemdeki kullanıcılar ve dosyalar bu kurulumla otomatik taşınmaz.

## Sık karşılaşılan sorunlar

| Belirti | Kontrol |
| --- | --- |
| Eksik environment hatası | Logda adı yazan değişkeni Environment’a ekle ve yeniden deploy et. |
| Veritabanı kurulumu tamamlanamadı | PostgreSQL hazır mı, Internal Connection URL doğru mu, iki servis aynı dahili ağda mı ve kullanıcı şema oluşturabiliyor mu? |
| 502 / Bad Gateway | Container loglarını ve Domains içindeki 3000 portunu kontrol et. |
| `/api/health` 503 | Veritabanı erişimini ve migration loglarını kontrol et. |
| Girişte “Geçersiz kaynak” | `SITE_URL` ile tarayıcıdaki HTTPS adresinin aynı olduğunu kontrol et. |
| Giriş sonrası oturum korunmuyor | HTTPS kullan ve alan adı tutarlılığını kontrol et. |
| Google `redirect_uri_mismatch` | Google istemcisindeki callback ile `SITE_URL`/`GOOGLE_REDIRECT_URI` değerlerini eşleştir. |
| Drive erişimi reddediliyor | Doğru OAuth istemcisi, izin kapsamı ve Google test/yayın erişimini kontrol et. |
| Eski Drive bağlantısı okunamıyor | Panelden Google Drive’ı yeniden bağla. Google istemci sırrı değiştiyse yeniden yetkilendirme gerekir. |

## Google 400 redirect_uri_mismatch hatasını doğrula

Yönetici hesabıyla `/admin` sayfasındaki **Google Drive bağlantı ayarlarını kontrol et** bölümünü aç. Burada canlı container’ın kullandığı gerçek Client ID, Authorized redirect URI ve JavaScript origin gösterilir. Aynı bilgiler `/api/google/drive/config` adresinde yalnızca yönetici oturumuna döner. Ziyaretçiler 401, normal üyeler 403 alır; yanıt önbelleğe alınmaz. Client Secret, erişim/yenileme token’ları, kullanıcı e-postaları ve diğer özel bilgiler bu ekranda veya yanıtta bulunmaz.

Google Cloud → Google Auth Platform → Clients içinde **ekranda görünen Client ID ile aynı** Web application istemcisini seç. Ekrandaki `redirectUri` değerini **Authorized redirect URIs** listesine birebir ekle; JavaScript origins alanına yazma. `www`, HTTPS ve sondaki slash farkı olmamalı. Kaydedip uygulamanın panelinden yeni bir bağlantı isteği başlat; önceki Google hata sekmesini tekrar kullanma.

Dokploy’da `SITE_URL=https://www.geteventsnap.com` kullanıyorsan dönüş adresi `https://www.geteventsnap.com/api/google/drive/callback` olmalıdır. `GOOGLE_REDIRECT_URI` boş bırakılabilir; uygulama doğru yolu `SITE_URL` üzerinden üretir. Doluysa aynı değeri taşımalıdır. Bu ekrandaki değişiklikler Google Cloud’a otomatik kaydedilmez; Google istemcisi tarafındaki izinli adres listesi ayrıca güncellenmelidir.

## Compose seçeneği

Application yerine Dokploy **Docker Compose** kullanacaksan Compose dosyası olarak `compose.yaml` seç. Aynı Environment değerlerini gir; domain’i `app` servisine, container portunu 3000’e bağla. Dosya `dokploy-network` üzerinden mevcut PostgreSQL servisine bağlanır; veritabanını ayrıca oluşturman gerekir. `compose.local.yaml` yalnızca yerel geliştirme içindir. [Dokploy Compose ağ/domain belgesi](https://docs.dokploy.com/docs/core/docker-compose/domains)
