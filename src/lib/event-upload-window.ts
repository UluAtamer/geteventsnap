export type UploadWindowState = 'not_started' | 'open' | 'closed'

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function getIstanbulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function getEventUploadWindow(eventDate: string, now = new Date()) {
  const lastUploadDate = addDays(eventDate, 7)
  const today = getIstanbulDate(now)
  const state: UploadWindowState = today < eventDate
    ? 'not_started'
    : today > lastUploadDate
      ? 'closed'
      : 'open'

  return { state, firstUploadDate: eventDate, lastUploadDate }
}
