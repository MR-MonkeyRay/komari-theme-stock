import countries from 'virtual:geo/countries'
import i18n from '../i18n'

// Komari stores `region` as a flag emoji (🇭🇰). Some setups use a plain ISO code.

/** In board order; OT is a node without a known region. */
export const CONTINENTS = ['AS', 'EU', 'NA', 'SA', 'OC', 'AF', 'AN', 'OT'] as const

export type ContinentCode = (typeof CONTINENTS)[number]

export function regionCode(region: string | undefined): string | null {
  if (!region) return null
  const chars = [...region.trim()]
  if (chars.length === 2 && chars.every((c) => c.codePointAt(0)! >= 0x1f1e6 && c.codePointAt(0)! <= 0x1f1ff)) {
    return chars.map((c) => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('')
  }
  const plain = region.trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(plain)) return plain === 'UK' ? 'GB' : plain
  return null
}

export interface RegionInfo {
  code: string | null
  continent: ContinentCode
  name: string
  lat: number | null
  lng: number | null
}

const regionNames = new Map<string, Intl.DisplayNames>()

/** The country or region's short name in `lang` (香港, Hong Kong, Hongkong). */
function countryName(code: string, lang: string) {
  let names = regionNames.get(lang)
  if (!names) regionNames.set(lang, (names = new Intl.DisplayNames(lang, { type: 'region', style: 'short', fallback: 'code' })))
  return names.of(code) ?? code
}

/** `lang`: the language of the name. */
export function regionInfo(region: string | undefined, lang: string): RegionInfo {
  const code = regionCode(region)
  const row = code ? countries[code] : undefined
  if (!code || !row) return { code, continent: 'OT', name: region?.trim() || continentName('OT'), lat: null, lng: null }
  return { code, continent: row[0] as ContinentCode, name: countryName(code, lang), lat: row[1], lng: row[2] }
}

export function continentName(code: string) {
  return (CONTINENTS as readonly string[]).includes(code) ? i18n.t(`continent.${code as ContinentCode}`) : code
}
