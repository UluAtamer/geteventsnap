import mysql from 'mysql2/promise'

// A pg-like client for maintenance scripts: query(sql, args) with $1… placeholders returns { rows, rowCount }.
export async function connect(url = process.env.DATABASE_URL, options = {}) {
  // Hostinger writes host "localhost"; Node may resolve it to ::1, which the database user is not granted.
  const target = new URL(url)
  if (target.hostname === 'localhost') target.hostname = '127.0.0.1'
  const connection = await mysql.createConnection({ uri: target.toString(), connectTimeout: 10000, charset: 'utf8mb4', timezone: 'Z', flags: ['-FOUND_ROWS'], ...options,
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) { const value = field.string(); return value === null ? null : value === '1' }
      return next()
    } })
  return wrap(connection)
}
export function wrap(connection) {
  return {
    async query(sql, args = []) {
      const ordered = []
      const text = /\$\d/.test(sql) ? sql.replace(/\$(\d+)/g, (_, i) => { ordered.push(args[Number(i) - 1]); return '?' }) : sql
      const values = (/\$\d/.test(sql) ? ordered : args).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v)
      const [result] = await connection.query(text, values)
      if (Array.isArray(result)) return { rows: result, rowCount: result.length }
      return { rows: [], rowCount: result.affectedRows }
    },
    end: () => connection.end(),
  }
}
