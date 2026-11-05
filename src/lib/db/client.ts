// Browser requests stay on this application's origin. No database credentials reach the browser.
async function authRequest(action: string, body?: unknown) {
  const response = await fetch(`/api/auth/${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const result = await response.json()
  return { data: result.data || { user: null, session: null }, error: result.error || null }
}
export function createClient() {
  return {
    auth: {
      getUser: () => authRequest('user'),
      signUp: (body: { email: string; password: string; options?: unknown }) => authRequest('signup', body),
      signInWithPassword: (body: { email: string; password: string }) => authRequest('login', body),
      updateUser: (body: { password: string; currentPassword: string }) => authRequest('password', body),
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'event-covers') throw new Error('Geçersiz dosya alanı.')
        return {
          async upload(path: string, file: File, _options?: unknown) {
            const response = await fetch(`/api/covers/${path}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
            return response.ok ? { error: null } : { error: { message: 'Kapak yüklenemedi.' } }
          },
          getPrivateUrl(path: string) { return { data: { privateUrl: `/api/covers/${path}` } } },
          async remove(paths: string[]) {
            const responses = await Promise.all(paths.map(path => fetch(`/api/covers/${path}`, { method: 'DELETE' })))
            return { error: responses.every(response => response.ok) ? null : { message: 'Kapak silinemedi.' } }
          },
        }
      },
    },
  }
}
