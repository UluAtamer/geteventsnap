const CANONICAL_HOST = 'www.geteventsnap.com'

export function normalizePublicAppUrl(url: URL) {
  if (
    process.env.NODE_ENV === 'production' &&
    (url.hostname === 'geteventsnap.com' || url.hostname.endsWith('.hostingersite.com'))
  ) {
    url.hostname = CANONICAL_HOST
  }

  return url
}

export function getPublicAppUrl(path: string, requestUrl: URL) {
  return normalizePublicAppUrl(new URL(path, process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin))
}
