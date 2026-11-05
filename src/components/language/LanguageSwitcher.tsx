'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

type Language = 'tr' | 'en'

declare global {
  interface Window {
    google?: {
      translate?: {
        TranslateElement?: new (
          options: { pageLanguage: string; includedLanguages: string; autoDisplay: boolean },
          elementId: string,
        ) => unknown
      }
    }
  }
}

function initializeTranslator() {
  const TranslateElement = window.google?.translate?.TranslateElement

  if (!TranslateElement || document.getElementById('google_translate_element')?.children.length) {
    return
  }

  new TranslateElement(
    { pageLanguage: 'tr', includedLanguages: 'tr,en', autoDisplay: false },
    'google_translate_element',
  )

  const savedLanguage = window.localStorage.getItem('geteventsnap-language')
  if (savedLanguage === 'en') {
    window.setTimeout(() => {
      const select = document.querySelector<HTMLSelectElement>('.goog-te-combo')
      if (select) {
        select.value = 'en'
        select.dispatchEvent(new Event('change'))
      }
    }, 300)
  }
}

export default function LanguageSwitcher() {
  const [language, setLanguage] = useState<Language>('tr')

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem('geteventsnap-language')
    if (savedLanguage === 'en') {
      setLanguage('en')
    }

    const timer = window.setTimeout(initializeTranslator, 500)
    return () => window.clearTimeout(timer)
  }, [])

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage)
    window.localStorage.setItem('geteventsnap-language', nextLanguage)

    const select = document.querySelector<HTMLSelectElement>('.goog-te-combo')
    if (!select) {
      initializeTranslator()
      return
    }

    select.value = nextLanguage
    select.dispatchEvent(new Event('change'))
  }

  return (
    <>
      <Script
        src="https://translate.google.com/translate_a/element.js"
        strategy="afterInteractive"
        onLoad={initializeTranslator}
      />
      <div id="google_translate_element" aria-hidden="true" />
      <div className="language-switcher" role="group" aria-label="Dil seçimi">
        <span className="language-icon" aria-hidden="true">◎</span>
        <button
          type="button"
          className={language === 'tr' ? 'language-active' : ''}
          onClick={() => changeLanguage('tr')}
          aria-label="Türkçe kullan"
          aria-pressed={language === 'tr'}
        >
          TR
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          className={language === 'en' ? 'language-active' : ''}
          onClick={() => changeLanguage('en')}
          aria-label="Use English"
          aria-pressed={language === 'en'}
        >
          EN
        </button>
      </div>
    </>
  )
}
