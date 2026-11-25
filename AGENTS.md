# Proje kuralları

- Kişisel veriler hiçbir zaman herkese açık yayınlanmamalıdır. Bu şart HTML, RSC yanıtları, API, görseller, metadata, loglar ve önbellekler için geçerlidir.
- Hesap verileri ve özel dosyalar yalnızca yetkili kullanıcıya sunulmalıdır. Her hesaplar arası erişim değişikliğinde gizlilik testlerini çalıştırın.
- Uygulama Hostinger Business Web Hosting’de (Node.js) çalışır; ayrıntılar `HOSTINGER.md` dosyasındadır.
- Gizli değerler yalnızca Hostinger hPanel’deki Node.js ortam değişkenleriyle çalışma zamanında sunucuya verilir. Gerçek anahtarları depoya, build argümanlarına veya NEXT_PUBLIC_ değişkenlerine eklemeyin.
- Veritabanı MySQL/MariaDB’dir ve web sitesiyle aynı Hostinger sunucusunda bulunur; uygulama `127.0.0.1` üzerinden bağlanır. Veritabanına uzaktan bağlantı (Remote MySQL) açmayın.
- İzin verilen tek harici uygulama entegrasyonu Google Drive/OAuth ve kullanıcının istediği kayıt onay e-postaları için SMTP’dir. Bunların dışında yeni harici servis veya AI entegrasyonu eklemeyin.
- Migration dosyaları çalıştırıldıktan sonra değiştirilmez; değişiklikler `db/mysql-migrations/` altında yeni numaralı migration dosyasına yazılır. `db/migrations/` eski PostgreSQL geçmişidir, kullanılmaz.
- Testler yerel, geçici bir MySQL/MariaDB ister (`TEST_DATABASE_URL`, varsayılan `mysql://root:testonly@127.0.0.1:33061/`): `docker run -d -p 127.0.0.1:33061:3306 -e MARIADB_ROOT_PASSWORD=testonly mariadb:11.4`
