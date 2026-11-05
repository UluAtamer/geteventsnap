import 'server-only'
import nodemailer from 'nodemailer'

export function mailConfigurationIssues() {
  const issues = new Set<string>()
  for (const name of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM']) {
    if (!process.env[name]?.trim()) issues.add(name)
  }
  if (process.env.SMTP_HOST && /[\s/]/.test(process.env.SMTP_HOST.trim())) issues.add('SMTP_HOST')
  if (process.env.SMTP_FROM && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(process.env.SMTP_FROM.trim())) issues.add('SMTP_FROM')
  const port = Number(process.env.SMTP_PORT || 465)
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.add('SMTP_PORT')
  const secure = process.env.SMTP_SECURE?.trim()
  if (secure && !['true','false'].includes(secure)) issues.add('SMTP_SECURE')
  try {
    const site = new URL(process.env.SITE_URL || '')
    if (!['http:','https:'].includes(site.protocol) || (process.env.NODE_ENV === 'production' && site.protocol !== 'https:') || site.username || site.password) issues.add('SITE_URL')
  } catch { issues.add('SITE_URL') }
  return [...issues]
}

function configuration() {
  if (mailConfigurationIssues().length) throw new Error('SMTP ayarları tamamlanmamış.')
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = process.env.SMTP_SECURE?.trim()
  return {
    host: process.env.SMTP_HOST!.trim(), user: process.env.SMTP_USER!.trim(),
    pass: process.env.SMTP_PASSWORD!, from: process.env.SMTP_FROM!.trim(),port,
    secure: secure ? secure === 'true' : port === 465,
    site: new URL(process.env.SITE_URL!),
  }
}

export function isMailConfigured() {
  const issues = mailConfigurationIssues()
  if (issues.length) console.warn(`[E-posta] Eksik/geçersiz environment alanları: ${issues.join(', ')}. Değerler gizlendi.`)
  return issues.length === 0
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
