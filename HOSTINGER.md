# Hostinger’da yayın

GetEventSnap, Hostinger Business Web Hosting’de Node.js (Next.js) uygulaması olarak çalışır. Veritabanı aynı sunucudaki MySQL/MariaDB’dir.

## Veritabanı

hPanel → Web siteleri → geteventsnap.com → Veritabanları üzerinden oluşturulur (veya API’deki “Setup website database”). Bu işlem `DATABASE_URL` (`mysql://…@127.0.0.1:3306/…`) ve `DB_*` değişkenlerini kendisi yazar; parola hiçbir yerde görüntülenmez. Remote MySQL erişimi açılmaz.

Şema, uygulama başlarken `npm start` öncesindeki `prestart` (`scripts/migrate.mjs`) ile `db/mysql-migrations/` dosyalarından uygulanır.

## Ortam değişkenleri (hPanel → Node.js → Environment variables)

| Değişken | Değer |
| --- | --- |
| `DATABASE_URL` | Veritabanı kurulumu tarafından yazılır |
| `SITE_URL` | `https://geteventsnap.com` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth istemcisi |
| `GOOGLE_REDIRECT_URI` | `https://geteventsnap.com/api/google/drive/callback` |
| `EMAIL_VERIFICATION_REQUIRED` | SMTP hazır olana kadar `false` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | E-posta onayı açılınca |
| `ADMIN_USER_ID` | İsteğe bağlı, yönetici hesabının UUID’si |

`NEXT_PUBLIC_` ile başlayan değişkenlere gizli değer yazılmaz. Değişken değişikliğinden sonra yeniden build alınır.
