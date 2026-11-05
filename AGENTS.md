# Proje kuralları

- Kişisel veriler hiçbir zaman herkese açık yayınlanmamalıdır. Bu şart HTML, RSC yanıtları, API, görseller, metadata, loglar ve önbellekler için geçerlidir.
- Hesap verileri ve özel dosyalar yalnızca yetkili kullanıcıya sunulmalıdır. Her hesaplar arası erişim değişikliğinde gizlilik testlerini çalıştırın.
- Gizli değerler Dokploy Environment üzerinden yalnızca çalışma zamanında sunucuya verilir. Gerçek anahtarları depoya, Docker imajına, build argümanlarına veya NEXT_PUBLIC_ değişkenlerine eklemeyin.
- Veritabanı PostgreSQL’dir ve Dokploy’un dahili ağında bulunur. İnternete veritabanı portu açmayın.
- İzin verilen tek harici uygulama entegrasyonu Google Drive/OAuth ve kullanıcının istediği kayıt onay e-postaları için SMTP’dir. Bunların dışında yeni harici servis veya AI entegrasyonu eklemeyin.
- Migration dosyaları çalıştırıldıktan sonra değiştirilmez; değişiklikler yeni numaralı migration dosyasına yazılır.
