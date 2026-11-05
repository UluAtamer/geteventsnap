export function getPublicAppUrl(path: string, requestUrl: URL) {
  return new URL(path, process.env.SITE_URL || requestUrl.origin)
}
