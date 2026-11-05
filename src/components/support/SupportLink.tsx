const supportEmail = 'destek@geteventsnap.com'

export default function SupportLink() {
  return (
    <a
      className="support-link"
      href={`mailto:${supportEmail}?subject=GetEventSnap%20destek%20talebi`}
      aria-label="GetEventSnap destek ekibine e-posta gönder"
      title="Destek ekibine ulaşın"
    >
      <span aria-hidden="true">✉</span>
      <span>Destek</span>
    </a>
  )
}
