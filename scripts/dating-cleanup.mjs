import pg from 'pg'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')

const client = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 })
client.on('error', () => console.error('[Tanışma] Temizlik bağlantısı kesildi.'))
let running = false
async function cleanup() {
  if (running) return
  running = true
  try {
    const condition = "event_id IN (SELECT id FROM events WHERE event_date < to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD'))"
    await client.query(`DELETE FROM guest_profiles WHERE ${condition}`)
    await client.query(`DELETE FROM dating_reports WHERE ${condition}`)
  } catch { console.error('[Tanışma] Gün sonu temizliği tamamlanamadı; yeniden denenecek.') }
  finally { running = false }
}
await cleanup()
setInterval(cleanup,60000)
