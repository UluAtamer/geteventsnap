import type { Metadata } from 'next'
import './globals.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3002'),
    title: {
      default: 'GetEventSnap | Düğün ve etkinlik anılarınız tek QR kodda',
      template: '%s | GetEventSnap',
    },
    description: 'Düğün, nişan, doğum günü ve parti fotoğraf ve videolarını QR kodla toplayın. Misafirler hesap açmadan yüklesin; anılar Google Drive’ınızda biriksin.',
    keywords: [
      'etkinlik fotoğrafı toplama',
      'düğün fotoğraf paylaşımı',
      'QR kod fotoğraf',
      'düğün fotoğrafları',
      'etkinlik anıları',
      'misafir fotoğraf yükleme',
      'etkinlik QR kodu',
      'Google Drive fotoğraf toplama',
    ],
    openGraph: {
      type: 'website',
      locale: 'tr_TR',
      url: '/',
      siteName: 'GetEventSnap',
      title: 'GetEventSnap | Düğün ve etkinlik anılarınız tek QR kodda',
      description: 'Düğün, nişan, doğum günü ve parti fotoğraf ve videolarını QR kodla toplayın. Misafirler hesap açmadan yüklesin; anılar Google Drive’ınızda biriksin.',
      images: [{ url: '/logo.png', width: 1254, height: 1254, alt: 'GetEventSnap etkinlik anıları logosu' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'GetEventSnap | Düğün ve etkinlik anılarınız tek QR kodda',
      description: 'Düğün, nişan, doğum günü ve parti fotoğraf ve videolarını QR kodla toplayın.',
      images: ['/logo.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    icons: {
      icon: '/icon.png',
      shortcut: '/icon.png',
      apple: '/icon.png',
    },
  }
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        {children}
        <footer className="site-credit">
          <span>AtamerADS yapımıdır</span>
        </footer>
      </body>
    </html>
  )
}
