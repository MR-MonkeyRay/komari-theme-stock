import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'
import { useSyncExternalStore } from 'react'
import { initReactI18next } from 'react-i18next'

// UI language: the visitor's own choice in the settings, else the first browser language the theme
// has, else English. Each language is a separate chunk, fetched before the first render.
//
// Komari's admin keeps its language under `language` in the same origin, but it also writes there
// the language it fell back to (English for a Korean browser, say), so it is not read here.

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' },
  { code: 'de', name: 'Deutsch' },
] as const

export type Lang = (typeof LANGUAGES)[number]['code']
const CODES: readonly string[] = LANGUAGES.map((l) => l.code)
const isLang = (v: unknown): v is Lang => typeof v === 'string' && CODES.includes(v)

/** The visitor's choice; absent means automatic. */
const KEY = 'komari-theme-stock.lang'

/**
 * A browser language tag as one of ours: Chinese by script (zh-HK, zh-MO and zh-Hant read as
 * Traditional), any Portuguese as Brazilian, the rest by language.
 */
export function toSupported(tag: string): string {
  try {
    const loc = new Intl.Locale(tag).maximize()
    if (loc.language === 'zh') return loc.script === 'Hant' ? 'zh-TW' : 'zh-CN'
    if (loc.language === 'pt') return 'pt-BR'
    return CODES.includes(loc.language) ? loc.language : tag
  } catch {
    return tag
  }
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
})

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(resourcesToBackend((lng: string) => import(`./locales/${lng}.json`)))
  .use(initReactI18next)
  .init({
    supportedLngs: CODES,
    load: 'currentOnly',
    // Simplified Chinese is the source and English is complete; Traditional Chinese falls back to
    // Simplified, everything else to English.
    fallbackLng: (code) => (code === 'zh-TW' ? ['zh-CN'] : code === 'zh-CN' || code === 'en' ? [] : ['en']),
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: KEY, caches: [], convertDetectedLanguage: toSupported },
    interpolation: { escapeValue: false },
    // An empty text is a real one (a unit some languages leave out), not a missing key.
    returnEmptyString: true,
    react: { useSuspense: false },
  })
  .then(
    () => undefined,
    () => undefined,
  )

// ---- The choice in the settings

const listeners = new Set<() => void>()

function readChoice(): Lang | 'auto' {
  try {
    const v = localStorage.getItem(KEY)
    return isLang(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function setLanguageChoice(choice: Lang | 'auto') {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // storage blocked: the choice holds for this visit only
  }
  listeners.forEach((f) => f())
  // Without an argument, i18next detects again (now from the browser).
  void i18n.changeLanguage(choice === 'auto' ? undefined : choice)
}

/** 'auto' or the language picked in the settings. */
export function useLanguageChoice() {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, readChoice)
}

/** The language in effect, for Intl formatters outside React. */
export const currentLanguage = () => i18n.resolvedLanguage ?? i18n.language ?? 'en'

export default i18n
