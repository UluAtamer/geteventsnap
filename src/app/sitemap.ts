import type { MetadataRoute } from 'next'

export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  if (!process.env.SITE_URL) return []

  return [
    {
      url: new URL('/', process.env.SITE_URL).toString(),
      priority: 1,
    },
  ]
}
