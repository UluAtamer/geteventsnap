type BrandLogoProps = {
  className?: string
}

export default function BrandLogo({ className }: BrandLogoProps) {
  return <img className={className} src="/logo.png" alt="GetEventSnap" />
}
