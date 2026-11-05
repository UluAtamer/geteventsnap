import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://www.geteventsnap.com/',
      priority: 1,
    },
  ]
}
