export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin')
  const expected = process.env.SITE_URL || (process.env.NODE_ENV !== 'production' ? new URL(request.url).origin : '')
  return !!origin && !!expected && origin === new URL(expected).origin
}
