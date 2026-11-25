export function isOwnedCover(url: string, userId: string) {
  if (['/covers/dugun.svg', '/covers/arkadas.svg', '/covers/parti.svg', '/covers/diger.svg'].includes(url)) return true
  return url.startsWith(`/api/covers/${userId}/`) &&
    /^\/api\/covers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url)
}

const presetCovers = ['/covers/dugun.svg', '/covers/arkadas.svg', '/covers/parti.svg', '/covers/diger.svg']

// Guests get a slug-scoped address for uploaded covers so owner IDs and storage paths never enter their HTML.
export function guestCoverSource(slug: string, presetCover: unknown, hasUploadedCover: unknown) {
  if (typeof presetCover === 'string' && presetCovers.includes(presetCover)) return presetCover
  return hasUploadedCover === true ? `/api/events/${encodeURIComponent(slug)}/cover` : null
}
