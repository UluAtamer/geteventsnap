# GetEventSnap

QR kod üzerinden fotoğraf ve videoları etkinlik sahibinin Google Drive hesabına gönderir. Kullanıcılar, parola özetleri, oturumlar, etkinlikler, özel kapaklar ve şifrelenmiş Drive bağlantıları PostgreSQL’de saklanır. Google Drive dışında harici uygulama servisi kullanılmaz.

## Dokploy kurulumu

Ayrıntılı, adım adım yükleme rehberi: [DOKPLOY.md](DOKPLOY.md).

1. Dokploy projesinde uygulamaya özel bir **PostgreSQL** servisi oluşturup çalıştırın. Veritabanının **Internal Connection URL** değerini alın; **External Port** alanını boş bırakın. Dokploy’un kendi sistem veritabanını kullanmayın.
2. Uygulama için Git deposunu bağlayın. **Application → Build Type: Dockerfile**, dosya `Dockerfile`, context `.` seçin. Alternatif olarak **Docker Compose** servisi oluşturup `compose.yaml` kullanabilirsiniz; bu dosya mevcut veritabanına `dokploy-network` üzerinden bağlanır ve yeni bir veritabanı oluşturmaz. Veritabanı ve uygulama aynı dahili ağda bulunmalıdır.
3. Uygulamanın **Environment** bölümüne aşağıdaki değerleri girin. Bunlar container çalışma zamanı değerleridir; build argument değildir. Gerçek değerleri depoya veya Dockerfile’a yazmayın.
4. **Domains** bölümünde kendi alan adınızı, container portunu **3000** ve HTTPS’i ayarlayın. `SITE_URL` buradaki HTTPS adresiyle aynı olmalıdır. Compose kullanıyorsanız domain’i `app` servisine bağlayın. Uygulama ve veritabanı için host portu yayınlamayın.
5. Deploy edin. Başlangıçta environment doğrulanır ve `db/migrations` dosyaları transaction ve kilitle uygulanır. Başarısız kurulumda uygulama başlamaz. `/api/health`, veritabanı erişimi varsa yalnızca `status: ok` döndürür.

```dotenv
DATABASE_URL=<PostgreSQL Internal Connection URL>
SITE_URL=https://<kendi-alan-adiniz>
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
DRIVE_TOKEN_ENCRYPTION_KEY=<32 bayt Base64 anahtar>
```

İsteğe bağlı değişkenler:

| Değişken | Kullanımı |
| --- | --- |
| `GOOGLE_REDIRECT_URI` | Boşsa `SITE_URL/api/google/drive/callback` kullanılır. Doluysa bu adresle aynı olmalı. |
| `ADMIN_USER_ID` | Yönetici yapılacak hesabın UUID değeri. Alternatif olarak seed hesabına kalıcı yönetici rolü atanabilir. E-posta adresiyle yönetici yetkisi verilmez. |
| `DATABASE_POOL_MAX` | Her uygulama işlemi için bağlantı sayısı; varsayılan 10. |
| `GUEST_MAX_PHOTO_BYTES` | Varsayılan 26214400 (25 MB). |
| `GUEST_MAX_VIDEO_BYTES` | Varsayılan 524288000 (500 MB). |

Şifreleme anahtarı üretmek için yerel terminalde `openssl rand -base64 32` çalıştırıp sonucu Dokploy Environment’a ekleyin. Anahtarı değiştirmek eski Drive bağlantılarının okunmasını engeller; korunmuş bir yedeğini tutun. Environment değişikliklerinden sonra yeniden deploy edin. Aynı Docker imajı farklı runtime environment değerleriyle kullanılabilir; `NEXT_PUBLIC_` değişkeni gerekmez.

PostgreSQL bağlantısı sadece sunucu kodunda kullanılır. `DATABASE_URL` içindeki kullanıcıya yalnızca bu uygulamanın veritabanında yetki verin. Dahili Dokploy bağlantısı için SSL ayarı Dokploy’un verdiği URL’den gelir; TLS kullanılıyorsa sertifika doğrulamasını kapatmayın. Veritabanı yedeklerini Dokploy’da özel erişimle yapılandırın. Uygulama container’ında kalıcı dosya tutulmadığı için ayrıca volume gerekmez.

Kurulum, Dokploy’un [veritabanı bağlantısı](https://docs.dokploy.com/docs/core/databases/connection) ve [Compose domain/ağ](https://docs.dokploy.com/docs/core/docker-compose/domains) belgelerindeki dahili ağ yaklaşımını kullanır.

İlk deployda geçici kullanıcı oluşturmak için `SEED_USER_ENABLED=true`, `SEED_USER_EMAIL` ve `SEED_USER_PASSWORD` değerlerini Dokploy Environment’a ekleyin. Hesap mevcutsa değiştirilmez. Girişten sonra panelde **Parola değiştir** bağlantısını kullanın, seed’i kapatıp seed e-posta/parola değişkenlerini kaldırın. Ayrıntılar [yükleme rehberinde](DOKPLOY.md).

## Google Drive

Google OAuth web istemcisinde Drive API’yi etkinleştirin. İzin kapsamı `https://www.googleapis.com/auth/drive.file` olmalıdır. Yetkili JavaScript kaynağına `SITE_URL` değerini, dönüş adresine aynı kaynaktaki `/api/google/drive/callback` yolunu ekleyin.

Uygulama Drive klasörüne herkese açık paylaşım izni eklemez. Misafir dosyaları ve isteğe bağlı ad/not bilgileri yalnızca etkinlik sahibinin Drive klasörüne gönderilir. Tarayıcıya Google erişim veya yenileme anahtarı verilmez.

## Gizlilik şartları

Kişisel veriler herkese açık yayınlanmamalıdır. Hesap ve etkinlik bilgileri yetkili panelde tutulur. Misafir sayfası kişisel bilgiler, adresler veya özel kapaklar içermez; HTML, RSC verisi ve sosyal paylaşım metadata’sı da buna dahildir. Özel kapaklar veritabanından yalnızca sahibinin oturumuyla sunulur. Her misafir yalnızca kendi tarayıcı kimliğiyle yüklediği dosyaları görebilir. Profil/iletişim paylaşan Tanışma modülü kaldırılmıştır.

Parolalar rastgele tuzla scrypt kullanılarak özetlenir. Oturum belirteçlerinin yalnızca özeti veritabanında saklanır; çerezler `HttpOnly`, üretimde `Secure` ve `SameSite=Lax` kullanır. Parola değişiminde ve hesap engellendiğinde oturumlar iptal edilir. Dış e-posta servisi olmadığı için otomatik e-posta doğrulama veya e-postayla parola kurtarma yoktur. Oturum içinden mevcut parola doğrulanarak parola değiştirilebilir.

## Yerel geliştirme ve doğrulama

Yalnızca web arayüzünü veritabanı olmadan görmek için `npm run preview:ui` çalıştırın ve `http://localhost:3002` adresini açın. Bu mod sadece geliştirmede etkindir; giriş/kayıt kapalıdır ve veritabanına bağlantı yapılmaz.

Docker Desktop açıkken `npm run dev:local` çalıştırın. İlk çalıştırmada özel `.env.local` dosyası ve yerel PostgreSQL oluşturulur, migration uygulanır ve uygulama `http://localhost:3002` adresinde başlar. Veritabanı yalnızca `127.0.0.1:54329` üzerinden erişilebilir ve verileri Docker volume’da korunur. Google Drive bağlantısı için `.env.local` içindeki OAuth bilgilerini doldurun. Yerel veritabanını durdurmak için `docker compose --env-file .env.local -f compose.local.yaml stop` kullanın.


Node.js 22 ve erişilebilir bir geliştirme PostgreSQL veritabanı kullanın. `.env.example` dosyasını `.env.local` olarak kopyalayıp kendi geliştirme değerlerinizi doldurun. Yerelde `SITE_URL=http://localhost:3002` ve Google dönüş adresi bu kaynakta olabilir; Docker üretim kurulumu HTTPS gerektirir.

```sh
npm ci
npm run dev -- --port 3002
```

`npm run dev` ve `npm start` öncesinde migration otomatik çalışır. Ayrı çalıştırmak için `npm run db:migrate` kullanın. Build sırasında veritabanı veya gizli değer gerekmez.

```sh
npm test
npx tsc --noEmit
npm run build
```

Testler izole bir PostgreSQL motorunda hesaplar arası erişimi, parola saklamayı, oturum iptalini ve ilişkili kayıtların silinmesini denetler. Üretim veritabanına bağlanmaz.

## Önceki kurulumdan geçiş

Bu depo eski hosting servislerini kapatmaz veya uzaktaki verileri silmez. Eski kullanıcı/veri kayıtları bu PostgreSQL’e otomatik aktarılmaz. Gerçek veriler taşınacaksa özel bir yedek ve ayrıca doğrulanmış aktarım gerekir. Eski oturumlar geçerli değildir; yeni kurulumda Drive bağlantısı yeniden yapılır. Kullanılmayan hosting ayarları, dağıtım arşivleri ve eski veritabanı migration dosyaları kaldırılmıştır.
