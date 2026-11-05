'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { getMapDirectionsUrl } from '@/lib/event-location'
import styles from './EventShareCard.module.css'

type EventShareCardProps = {
  slug: string
  title: string
  eventAddress?: string | null
  eventTime?: string | null
}

export default function EventShareCard({
  slug,
  title,
  eventAddress,
  eventTime,
}: EventShareCardProps) {
  const [qrCode, setQrCode] = useState('')
  const [qrError, setQrError] = useState('')
  const [copied, setCopied] = useState(false)
  const [eventUrl, setEventUrl] = useState(`/e/${slug}`)
  const [isMounted, setIsMounted] = useState(false)
  const portalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsMounted(true)
    let isMounted = true
    const url = `${window.location.origin}/e/${slug}`
    setEventUrl(url)

    QRCode.toDataURL(url, { width: 260, margin: 2, errorCorrectionLevel: 'H' })
      .then((dataUrl) => {
        if (isMounted) setQrCode(dataUrl)
      })
      .catch(() => {
        if (isMounted) setQrError('QR kodu oluşturulamadı. Sayfayı yenileyip tekrar deneyin.')
      })

    return () => {
      isMounted = false
    }
  }, [slug])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/e/${slug}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setQrError('Bağlantı kopyalanamadı. Bağlantıyı elle seçip kopyalayın.')
    }
  }

  async function printCard() {
    await document.fonts.ready
    document.querySelectorAll('[data-print-active]').forEach((el) => el.removeAttribute('data-print-active'))
    portalRef.current?.setAttribute('data-print-active', 'true')
    // Some browsers fire afterprint (or render the preview) asynchronously, so the marker stays until the next print.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.print()
  }

  function formatEventTimeLabel(value?: string | null) {
    if (!value) return ''
    return value.length > 5 ? value.slice(0, 5) : value
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth || !currentLine) {
        currentLine = candidate
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }

  function downloadInvitationCard() {
    if (!qrCode) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    const width = 1200
    const height = 1600
    canvas.width = width
    canvas.height = height

    const background = ctx.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, '#fff9f7')
    background.addColorStop(1, '#fbe8ee')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = '#f5dfe6'
    ctx.fillRect(120, 110, width - 240, 130)

    ctx.fillStyle = '#81213d'
    ctx.font = '700 42px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('ANILARIMIZI PAYLAŞIN', width / 2, 185)

    ctx.fillStyle = '#2d1f22'
    ctx.textAlign = 'center'
    ctx.font = '700 74px Georgia'
    const titleLines = wrapText(ctx, title, 720)
    const titleStartY = 320
    titleLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, titleStartY + index * 80)
    })

    const detailsY = titleStartY + (titleLines.length * 80) + 90
    ctx.fillStyle = '#5e4348'
    ctx.font = '600 34px Arial'
    const detailLines: string[] = []
    const timeLabel = formatEventTimeLabel(eventTime)
    if (timeLabel) {
      detailLines.push(`Saat: ${timeLabel}`)
    }
    if (eventAddress) {
      detailLines.push(`Adres: ${eventAddress}`)
    }

    detailLines.forEach((line, index) => {
      const textLines = wrapText(ctx, line, 760)
      textLines.forEach((wrappedLine, wrappedIndex) => {
        ctx.fillText(wrappedLine, width / 2, detailsY + index * 60 + wrappedIndex * 32)
      })
    })

    const qrSize = 420
    const qrX = (width - qrSize) / 2
    const qrY = 760
    const qrImage = new Image()
    qrImage.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(qrX - 28, qrY - 28, qrSize + 56, qrSize + 56)
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)

      ctx.fillStyle = '#81213d'
      ctx.font = '600 32px Arial'
      ctx.fillText('Fotoğraf ve videolarını paylaşmak için tara', width / 2, qrY + qrSize + 72)

      ctx.fillStyle = '#5f4f52'
      ctx.font = '500 26px Arial'
      ctx.fillText(window.location.origin || 'https://localhost:3002', width / 2, qrY + qrSize + 114)

      const link = document.createElement('a')
      link.download = `${slug}-davetiyesi.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    qrImage.src = qrCode
  }

  const printableCard = (
    <div className={styles.printCard}>
      <p className={styles.printEyebrow}>ANILARIMIZI PAYLAŞIN</p>
      <span className={styles.printOrnament} aria-hidden="true">❦</span>
      <strong className={styles.printTitle}>{title}</strong>
      {eventTime && <p className={styles.printDetails}>Saat {eventTime.slice(0, 5)}</p>}
      {eventAddress && <p className={styles.printAddress}>{eventAddress}</p>}
      {qrCode && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.qr} src={qrCode} alt={`${title} etkinlik bağlantısı için QR kod`} />
      )}
      <p className={styles.printPrompt}>Fotoğraf ve videolarınızı paylaşmak için<br />telefonunuzun kamerasıyla QR kodu okutun</p>
      <p className={styles.printBrand}>GetEventSnap</p>
    </div>
  )

  return (
    <>
      <div className={styles.share}>
        {qrError && <p className={styles.error} role="alert">{qrError}</p>}
        {printableCard}
        <p className={styles.linkLabel}>Etkinlik bağlantısı</p>
        <a className={styles.eventLink} href={`/e/${slug}`} target="_blank" rel="noreferrer">{eventUrl}</a>
        <div className={styles.actions}>
          {eventAddress && (
            <a
              className={styles.secondary}
              href={getMapDirectionsUrl(eventAddress)}
              target="_blank"
              rel="noreferrer"
            >
              Adrese git
            </a>
          )}
          <button className={styles.secondary} type="button" onClick={copyLink}>
            {copied ? 'Kopyalandı!' : 'Bağlantıyı kopyala'}
          </button>
          {qrCode && (
            <button className={styles.secondary} type="button" onClick={downloadInvitationCard}>
              Davetiyeyi indir
            </button>
          )}
          <button className={styles.primary} type="button" onClick={printCard} disabled={!qrCode}>
            QR kartını yazdır
          </button>
        </div>
      </div>
      {isMounted && createPortal(
        <div className={styles.printPortal} data-print-portal ref={portalRef} aria-hidden="true">
          {printableCard}
        </div>,
        document.body,
      )}
    </>
  )
}
