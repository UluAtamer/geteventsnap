import { connect } from './mysql-client.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')

const istanbulDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
let running = false
async function cleanup() {
  if (running) return
  running = true
  let client
  try {
    client = await connect()
    const condition = 'event_id IN (SELECT id FROM events WHERE event_date < ?)'
    await client.query(`DELETE FROM guest_profiles WHERE ${condition}`, [istanbulDate()])
    await client.query(`DELETE FROM dating_reports WHERE ${condition}`, [istanbulDate()])
  } catch { console.error('[Tanışma] Gün sonu temizliği tamamlanamadı; yeniden denenecek.') }
  finally { await client?.end().catch(() => {}); running = false }
}
await cleanup()
setInterval(cleanup,60000)
