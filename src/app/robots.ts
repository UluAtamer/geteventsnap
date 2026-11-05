import type { MetadataRoute } from 'next'

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/api/', '/e/', '/sifre-yenile', '/eposta-onay'],
    },
    ...(process.env.SITE_URL
      ? { sitemap: new URL('/sitemap.xml', process.env.SITE_URL).toString() }
      : {}),
  }
}
