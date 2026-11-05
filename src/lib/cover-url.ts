export function isOwnedCover(url: string, userId: string) {
  if (['/covers/dugun.svg', '/covers/arkadas.svg', '/covers/parti.svg', '/covers/diger.svg'].includes(url)) return true
  return url.startsWith(`/api/covers/${userId}/`) &&
    /^\/api\/covers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url)
}
