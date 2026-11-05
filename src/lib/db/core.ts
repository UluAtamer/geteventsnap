import { isUiPreview } from '../ui-preview'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

export type Row = Record<string, any>
export type DbError = { message: string; code: string } | null
export type Result<T> = { data: T; error: DbError }
export type User = { id: string; email: string; created_at: string; banned_until?: string; last_sign_in_at?: string }
let pool: pg.Pool | undefined

function connectionPool() {
  if (isUiPreview()) throw new Error('Arayüz önizlemesinde veritabanı bağlantısı kapalı.');
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tanımlı değil.')
  const maximum = Number(process.env.DATABASE_POOL_MAX || 10)
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('Geçersiz bağlantı havuzu boyutu.')
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: maximum,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  })
  pool.on('error', () => console.error('Veritabanı bağlantısı kesildi.'))
  return pool
}

function numbered(sql: string) {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}
export function database() {
  return {
    prepare(sql: string) {
      const query = (args: unknown[]) => connectionPool().query(numbered(sql), args)
      return {
        async all(...args: unknown[]): Promise<Row[]> { return (await query(args)).rows },
        async get(...args: unknown[]): Promise<Row | undefined> { return (await query(args)).rows[0] },
        async run(...args: unknown[]) { return query(args) },
      }
    },
    async close() { if (pool) { await pool.end(); pool = undefined } },
  }
}
export async function transaction<T>(operation: (client: pg.PoolClient) => Promise<T>) {
  const client = await connectionPool().connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export function publicUser(row: Row): User {
  return { id: row.id, email: row.email, created_at: row.created_at,
    banned_until: row.banned_until || undefined, last_sign_in_at: row.last_sign_in_at || undefined }
}

const tables = new Set(['events', 'profiles', 'event_drive_connections', 'uploads_meta'])
function identifier(value: string) {
  if (!/^[a-z_]+$/.test(value)) throw new Error('Geçersiz alan.')
  return `"${value}"`
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
      const db = database()
      const table = identifier(this.table)
      const fields = this.columns === '*' ? '*' : this.columns.split(',').map(x => identifier(x.trim())).join(',')
      const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : ''
      let rows: Row[]
      if (this.operation === 'select') {
        rows = await db.prepare(`SELECT ${fields} FROM ${table}${where}${this.sort} LIMIT ? OFFSET ?`).all(...this.args, this.max, this.offset)
      } else if (this.operation === 'delete') {
        rows = await db.prepare(`DELETE FROM ${table}${where} RETURNING ${fields}`).all(...this.args)
      } else if (this.operation === 'update') {
        const keys = Object.keys(this.values)
        rows = await db.prepare(`UPDATE ${table} SET ${keys.map(k => `${identifier(k)} = ?`).join(',')}${where} RETURNING ${fields}`).all(...keys.map(k => bind(this.values[k])), ...this.args)
      } else {
        const now = new Date().toISOString()
        const values = { ...this.values }
        if (['events','uploads_meta'].includes(this.table)) values.id ??= randomUUID()
        if (['events','profiles'].includes(this.table)) values.created_at ??= now
        if (this.table === 'event_drive_connections') values.connected_at ??= now
        if (this.table === 'uploads_meta') values.uploaded_at ??= now
        const keys = Object.keys(values)
        const conflict = this.operation === 'upsert'
          ? ` ON CONFLICT (${identifier(this.conflict)}) DO ${this.ignoreDuplicates ? 'NOTHING' : 'UPDATE SET ' + keys.filter(k => k !== 'id' && k !== this.conflict).map(k => `${identifier(k)} = excluded.${identifier(k)}`).join(',')}` : ''
        rows = await db.prepare(`INSERT INTO ${table} (${keys.map(identifier).join(',')}) VALUES (${keys.map(() => '?').join(',')})${conflict} RETURNING ${fields}`).all(...keys.map(k => bind(values[k])))
      }
      return { data: (this.one ? rows[0] || null : rows) as T, error: null }
    } catch {
      return { data: (this.one ? null : []) as T, error: { message: 'Veritabanı işlemi tamamlanamadı.', code: 'database_error' } }
    }
  }
}

export async function consumeRateLimit(bucket: string, maximum: number) {
  const db = database()
  const window = Math.floor(Date.now() / 60000)
  const row = await db.prepare(`INSERT INTO rate_limits(bucket, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,
    count=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.count+1 ELSE 1 END RETURNING count`).get(bucket, window)
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(window - 1440)
  return Number(row?.count) <= maximum
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
      const row = await db.prepare(`INSERT INTO csv_locks(event_id, token, expires) VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET token=excluded.token, expires=excluded.expires
        WHERE csv_locks.expires < ? RETURNING event_id`).get(args.p_event_id, args.p_lock_token, Date.now() + args.p_lease_seconds * 1000, Date.now())
      return { data: !!row, error: null }
    }
    if (name === 'release_event_upload_csv_lock') {
      await db.prepare('DELETE FROM csv_locks WHERE event_id=? AND token=?').run(args.p_event_id, args.p_lock_token)
      return { data: true, error: null }
    }
    throw new Error('Bilinmeyen işlem.')
  } catch { return { data: null, error: { message: 'Veritabanı işlemi tamamlanamadı.', code: 'database_error' } } }
}
