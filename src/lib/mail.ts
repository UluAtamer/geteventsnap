import 'server-only'
import nodemailer from 'nodemailer'

function configuration() {
  const host = process.env.SMTP_HOST?.trim()
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM?.trim()
  const port = Number(process.env.SMTP_PORT || 465)
  const secureSetting = process.env.SMTP_SECURE
  if (!host || /[\s/]/.test(host) || !user || !pass || !from ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from) ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      (secureSetting && !['true','false'].includes(secureSetting))) throw new Error('SMTP ayarları tamamlanmamış.')
  const site = new URL(process.env.SITE_URL || '')
  if ((process.env.NODE_ENV === 'production' && site.protocol !== 'https:') || !['https:','http:'].includes(site.protocol) || site.username || site.password) throw new Error('SITE_URL geçersiz.')
  return { host, user, pass, from, port, secure: secureSetting ? secureSetting === 'true' : port === 465, site }
}

export function isMailConfigured() {
  try { configuration(); return true } catch { return false }
}

export async function sendVerificationEmail(email: string, token: string) {
  const config = configuration()
  const url = new URL('/eposta-onay', config.site)
  // Fragments never reach server access logs or the Referer header.
  url.hash = `token=${token}`
  const link = url.toString()
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  })
  try {
    const result = await transport.sendMail({
      from: { name: 'GetEventSnap', address: config.from },
      to: { address: email, name: '' },
      subject: 'GetEventSnap e-posta adresinizi onaylayın',
      text: `Hesabınızı kullanmaya başlamak için e-posta adresinizi onaylayın:\n\n${link}\n\nBağlantı 30 dakika geçerlidir ve tek kullanımlıktır. Bu kaydı siz oluşturmadıysanız bağlantıyı açmadan bu e-postayı yok sayın.`,
      html: `<p>GetEventSnap hesabınızı kullanmaya başlamak için e-posta adresinizi onaylayın.</p><p><a href="${link}">E-posta adresimi onayla</a></p><p>Bağlantı 30 dakika geçerlidir ve tek kullanımlıktır.</p><p>Bu kaydı siz oluşturmadıysanız bağlantıyı açmadan bu e-postayı yok sayın.</p>`,
    })
    if (!result.accepted.length) throw new Error('E-posta kabul edilmedi.')
  } finally { transport.close() }
}
