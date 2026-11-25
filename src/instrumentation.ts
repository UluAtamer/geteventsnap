export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LOCAL_UI_PREVIEW === '1' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { applyMigrations } = await import('./lib/db/migrate')
  try {
    await applyMigrations()
    console.log('[Veritabanı] Şema kontrolü tamamlandı; veritabanı hazır.')
  } catch {
    // Never log the connection URL. /api/health reports unavailable until this succeeds.
    console.error('Veritabanı kurulumu tamamlanamadı. DATABASE_URL ve veritabanı izinlerini kontrol edin.')
  }
}
