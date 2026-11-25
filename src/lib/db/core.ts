import { isUiPreview } from '../ui-preview'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'

export type Row = Record<string, any>
export type DbError = { message: string; code: string } | null
export type Result<T> = { data: T; error: DbError }
export type User = { id: string; is_admin: boolean; email_verified_at: string | null; email: string; created_at: string; banned_until?: string; last_sign_in_at?: string }
export type QueryResult = { rows: Row[]; rowCount: number }
export type TxClient = { query(sql: string, args?: unknown[]): Promise<QueryResult> }
let pool: mysql.Pool | undefined

// BOOLEAN columns are TINYINT(1); return them as JavaScript booleans like PostgreSQL did.
const typeCast: mysql.TypeCast = (field, next) => {
  if (field.type === 'TINY' && field.length === 1) {
    const value = field.string()
    return value === null ? null : value === '1'
  }
  return next()
}

// Hostinger writes host "localhost"; Node may resolve it to ::1, which the database user is not granted.
export function localDatabaseUrl(value: string) {
  const url = new URL(value)
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.toString()
}

function connectionPool() {
  if (isUiPreview()) throw new Error('Arayüz önizlemesinde veritabanı bağlantısı kapalı.');
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')
  const maximum = Number(process.env.DATABASE_POOL_MAX || 10)
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('Geçersiz bağlantı havuzu boyutu.')
  pool = mysql.createPool({
    uri: localDatabaseUrl(process.env.DATABASE_URL),
    connectionLimit: maximum,
    connectTimeout: 10000,
    idleTimeout: 30000,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    // affectedRows must count changed rows (0 for ignored duplicates), not matched rows.
    flags: ['-FOUND_ROWS'],
    typeCast,
  })
  return pool
}

type Executor = { query: mysql.Pool['query'] }
async function run(executor: Executor, sql: string, args: unknown[]): Promise<QueryResult> {
  const [result] = await executor.query(sql, args.map(value => typeof value === 'boolean' ? (value ? 1 : 0) : value))
  if (Array.isArray(result)) return { rows: result as Row[], rowCount: result.length }
  return { rows: [], rowCount: (result as mysql.ResultSetHeader).affectedRows }
}

// Transaction code uses numbered placeholders ($1, $2 …); a number may repeat.
function positional(sql: string, args: unknown[]) {
  const ordered: unknown[] = []
  const text = sql.replace(/\$(\d+)/g, (_, index) => { ordered.push(args[Number(index) - 1]); return '?' })
  return { text, ordered: /\$\d/.test(sql) ? ordered : args }
}

export function database() {
  return {
    prepare(sql: string) {
      const query = (args: unknown[]) => run(connectionPool(), sql, args)
      return {
        async all(...args: unknown[]): Promise<Row[]> { return (await query(args)).rows },
        async get(...args: unknown[]): Promise<Row | undefined> { return (await query(args)).rows[0] },
        async run(...args: unknown[]) { return query(args) },
      }
    },
    async close() { if (pool) { await pool.end(); pool = undefined } },
  }
}
export async function transaction<T>(operation: (client: TxClient) => Promise<T>) {
  const connection = await connectionPool().getConnection()
  const client: TxClient = {
    query(sql, args = []) { const { text, ordered } = positional(sql, args); return run(connection, text, ordered) },
  }
  try {
    await connection.beginTransaction()
    const result = await operation(client)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally { connection.release() }
}

export function publicUser(row: Row): User {
  return { id: row.id, is_admin: row.is_admin === true, email_verified_at: row.email_verified_at || null, email: row.email, created_at: row.created_at,
    banned_until: row.banned_until || undefined, last_sign_in_at: row.last_sign_in_at || undefined }
}

const tables = new Set(['events', 'profiles', 'event_drive_connections', 'uploads_meta'])
const primaryKey: Record<string, string> = { events: 'id', profiles: 'id', event_drive_connections: 'event_id', uploads_meta: 'id' }
function identifier(value: string) {
  if (!/^[a-z_]+$/.test(value)) throw new Error('Geçersiz alan.')
  return `\`${value}\``
}
function bind(value: unknown): string | number | null {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value == null) return null
  throw new Error('Geçersiz değer.')
}

// Only server code constructs queries. The browser has no generic database endpoint.
export class Query<T = Row[]> implements PromiseLike<Result<T>> {
  private columns = '*'
  private filters: string[] = []
  private args: (string | number | null)[] = []
  private operation = 'select'
  private values: Row = {}
  private conflict = ''
  private ignoreDuplicates = false
  private sort = ''
  private max = 10000
  private offset = 0
  private one = false
  constructor(private table: string, private owner: string | null, private privileged: boolean) {
    if (!tables.has(table)) throw new Error('Tabloya erişim yok.')
  }
  select(columns = '*') { this.columns = columns; return this }
  eq(column: string, value: unknown) { this.filters.push(`${identifier(column)} = ?`); this.args.push(bind(value)); return this }
  in(column: string, values: unknown[]) {
    this.filters.push(values.length ? `${identifier(column)} IN (${values.map(() => '?').join(',')})` : '0')
    this.args.push(...values.map(bind)); return this
  }
  order(column: string, options?: { ascending?: boolean }) { this.sort = ` ORDER BY ${identifier(column)} ${options?.ascending === false ? 'DESC' : 'ASC'}`; return this }
  limit(count: number) { this.max = Math.max(0, Math.min(10000, Math.trunc(count))); return this }
  range(from: number, to: number) { this.offset = Math.max(0, Math.trunc(from)); return this.limit(to - from + 1) }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this }
  update(values: Row) { this.operation = 'update'; this.values = values; return this }
  delete() { this.operation = 'delete'; return this }
  upsert(values: Row, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.operation = 'upsert'; this.values = values; this.conflict = options?.onConflict || 'event_id';
    this.ignoreDuplicates = !!options?.ignoreDuplicates; return this
  }
  single(): Query<Row> { this.one = true; return this as unknown as Query<Row> }
  maybeSingle(): Query<Row | null> { this.one = true; return this as unknown as Query<Row | null> }
  then<TResult1 = Result<T>, TResult2 = never>(onfulfilled?: ((value: Result<T>) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }
  private async execute(): Promise<Result<T>> {
    try {
      if (!this.privileged) {
        if (!this.owner || !['events', 'profiles'].includes(this.table)) throw new Error('Yetkisiz erişim.')
        this.eq(this.table === 'profiles' ? 'id' : 'owner_id', this.owner)
        if (['insert', 'upsert', 'update'].includes(this.operation)) {
          const key = this.table === 'profiles' ? 'id' : 'owner_id'
          if (this.values[key] && this.values[key] !== this.owner) throw new Error('Yetkisiz erişim.')
          this.values[key] = this.owner
        }
      }
      const table = identifier(this.table)
      const pk = identifier(primaryKey[this.table])
      const fields = this.columns === '*' ? '*' : this.columns.split(',').map(x => identifier(x.trim())).join(',')
      const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : ''
      let rows: Row[]
      if (this.operation === 'select') {
        rows = await database().prepare(`SELECT ${fields} FROM ${table}${where}${this.sort} LIMIT ? OFFSET ?`).all(...this.args, this.max, this.offset)
      } else if (this.operation === 'delete') {
        // MySQL has no RETURNING: lock and read the rows, then delete exactly those.
        rows = await transaction(async client => {
          const found = (await client.query(`SELECT * FROM ${table}${where} FOR UPDATE`, this.args)).rows
          if (found.length) await client.query(`DELETE FROM ${table} WHERE ${pk} IN (${found.map(() => '?').join(',')})`, found.map(r => r[primaryKey[this.table]]))
          return found
        })
        rows = this.project(rows)
      } else if (this.operation === 'update') {
        const keys = Object.keys(this.values)
        rows = await transaction(async client => {
          const ids = (await client.query(`SELECT ${pk} FROM ${table}${where} FOR UPDATE`, this.args)).rows.map(r => r[primaryKey[this.table]])
          if (!ids.length) return []
          const marks = ids.map(() => '?').join(',')
          await client.query(`UPDATE ${table} SET ${keys.map(k => `${identifier(k)} = ?`).join(',')} WHERE ${pk} IN (${marks})`, [...keys.map(k => bind(this.values[k])), ...ids])
          return (await client.query(`SELECT ${fields} FROM ${table} WHERE ${pk} IN (${marks})`, ids)).rows
        })
      } else {
        const now = new Date().toISOString()
        const values = { ...this.values }
        if (['events','uploads_meta'].includes(this.table)) values.id ??= randomUUID()
        if (['events','profiles'].includes(this.table)) values.created_at ??= now
        if (this.table === 'event_drive_connections') values.connected_at ??= now
        if (this.table === 'uploads_meta') values.uploaded_at ??= now
        const keys = Object.keys(values)
        const conflictColumn = this.operation === 'upsert' ? this.conflict : primaryKey[this.table]
        const updates = keys.filter(k => k !== 'id' && k !== conflictColumn)
        const conflict = this.operation !== 'upsert' ? ''
          : this.ignoreDuplicates || !updates.length ? ` ON DUPLICATE KEY UPDATE ${identifier(conflictColumn)} = ${identifier(conflictColumn)}`
          : ` ON DUPLICATE KEY UPDATE ${updates.map(k => `${identifier(k)} = VALUES(${identifier(k)})`).join(',')}`
        rows = await transaction(async client => {
          const result = await client.query(`INSERT INTO ${table} (${keys.map(identifier).join(',')}) VALUES (${keys.map(() => '?').join(',')})${conflict}`, keys.map(k => bind(values[k])))
          // affectedRows is 0 when a duplicate was ignored; PostgreSQL returned no row then.
          // An upsert that changed nothing also reports 0, but still returns the row.
          if ((this.ignoreDuplicates || !updates.length) && !result.rowCount) return []
          return (await client.query(`SELECT ${fields} FROM ${table} WHERE ${identifier(conflictColumn)} = ?`, [bind(values[conflictColumn])])).rows
        })
      }
      return { data: (this.one ? rows[0] || null : rows) as T, error: null }
    } catch {
      return { data: (this.one ? null : []) as T, error: { message: 'Veritabanı işlemi tamamlanamadı.', code: 'database_error' } }
    }
  }
  private project(rows: Row[]) {
    if (this.columns === '*') return rows
    const names = this.columns.split(',').map(x => x.trim())
    return rows.map(row => Object.fromEntries(names.map(name => [name, row[name]])))
  }
}

export async function consumeRateLimit(bucket: string, maximum: number) {
  const window = Math.floor(Date.now() / 60000)
  const count = await transaction(async client => {
    // count is assigned before window_start, so it compares against the stored window.
    await client.query(`INSERT INTO rate_limits(bucket, window_start, count) VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE count = IF(window_start = VALUES(window_start), count + 1, 1), window_start = VALUES(window_start)`, [bucket, window])
    const row = (await client.query('SELECT count FROM rate_limits WHERE bucket = ?', [bucket])).rows[0]
    await client.query('DELETE FROM rate_limits WHERE window_start < ?', [window - 1440])
    return Number(row?.count)
  })
  return count <= maximum
}

export async function rpc(name: string, args: Row = {}, owner: string | null = null, privileged = false): Promise<Result<any>> {
  try {
    const db = database()
    if (name === 'get_owner_event_upload_stats' && owner) {
      const rows = await db.prepare(`SELECT e.id AS event_id, count(u.id) AS file_count, count(DISTINCT u.guest_hash) AS guest_count
        FROM events e LEFT JOIN uploads_meta u ON u.event_id=e.id WHERE e.owner_id=? GROUP BY e.id`).all(owner)
      return { data: rows.map(row => ({ event_id: row.event_id, file_count: Number(row.file_count), guest_count: Number(row.guest_count) })), error: null }
    }
    if (!privileged) throw new Error('Yetkisiz erişim.')
    if (name === 'consume_guest_upload_rate_limit') return { data: await consumeRateLimit(args.p_bucket_hash, args.p_max_requests), error: null }
    if (name === 'acquire_event_upload_csv_lock') {
      const now = Date.now()
      // token is assigned before expires, so both compare against the stored lease.
      // affectedRows: 1 = new lock, 2 = expired lease taken over, 0 = still held (by anyone).
      const result = await db.prepare(`INSERT INTO csv_locks(event_id, token, expires) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE token = IF(expires < ?, VALUES(token), token), expires = IF(expires < ?, VALUES(expires), expires)`)
        .run(args.p_event_id, args.p_lock_token, now + args.p_lease_seconds * 1000, now, now)
      const acquired = result.rowCount > 0
      return { data: acquired, error: null }
    }
    if (name === 'release_event_upload_csv_lock') {
      await db.prepare('DELETE FROM csv_locks WHERE event_id=? AND token=?').run(args.p_event_id, args.p_lock_token)
      return { data: true, error: null }
    }
    throw new Error('Bilinmeyen işlem.')
  } catch { return { data: null, error: { message: 'Veritabanı işlemi tamamlanamadı.', code: 'database_error' } } }
}
