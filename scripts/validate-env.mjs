const required = ['DATABASE_URL', 'SITE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
const missing = required.filter(name => !process.env[name]?.trim())
if (missing.length) {
  console.error(`Eksik environment değişkenleri: ${missing.join(', ')}`)
  process.exit(1)
}
try {
  const database = new URL(process.env.DATABASE_URL)
  const site = new URL(process.env.SITE_URL)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL PostgreSQL bağlantısı olmalı.')
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/') throw new Error('SITE_URL yalnızca HTTPS site kaynağını içermeli.')
  if (process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_REDIRECT_URI !== new URL('/api/google/drive/callback', site).toString()) throw new Error('GOOGLE_REDIRECT_URI site callback adresiyle eşleşmeli.')
  if (process.env.ADMIN_USER_ID && !/^[a-f0-9-]{36}$/i.test(process.env.ADMIN_USER_ID)) throw new Error('ADMIN_USER_ID geçerli bir kullanıcı UUID değeri olmalı.')
  if (process.env.SEED_USER_ENABLED && !['true', 'false'].includes(process.env.SEED_USER_ENABLED)) throw new Error('SEED_USER_ENABLED true veya false olmalı.')
  if (process.env.SEED_USER_IS_ADMIN && !['true', 'false'].includes(process.env.SEED_USER_IS_ADMIN)) throw new Error('SEED_USER_IS_ADMIN true veya false olmalı.')
  if (process.env.SEED_USER_ENABLED === 'true') {
    const email = (process.env.SEED_USER_EMAIL || '').trim()
    const password = process.env.SEED_USER_PASSWORD || ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) throw new Error('Seed e-posta adresi geçerli, parolası 12–128 karakter olmalı.')
  }
  if (Object.keys(process.env).some(key => /^NEXT_PUBLIC_.*(KEY|SECRET|TOKEN|PASSWORD|DATABASE)/.test(key))) throw new Error('Gizli değerler NEXT_PUBLIC_ değişkenlerinde tutulamaz.')
} catch (error) {
  console.error(error instanceof TypeError ? 'Environment adres biçimi geçersiz.' : error.message)
  process.exit(1)
}
