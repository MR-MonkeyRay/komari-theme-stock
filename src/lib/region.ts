import countries from 'virtual:geo/countries'

// Komari stores `region` as a flag emoji (🇭🇰). Some setups use a plain ISO code.

export const CONTINENTS = [
  { code: 'AS', name: '亚洲' },
  { code: 'EU', name: '欧洲' },
  { code: 'NA', name: '北美洲' },
  { code: 'SA', name: '南美洲' },
  { code: 'OC', name: '大洋洲' },
  { code: 'AF', name: '非洲' },
  { code: 'AN', name: '南极洲' },
  { code: 'OT', name: '未设置' },
] as const

export type ContinentCode = (typeof CONTINENTS)[number]['code']

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

export function regionInfo(region: string | undefined): RegionInfo {
  const code = regionCode(region)
  const row = code ? countries[code] : undefined
  if (!code || !row) return { code, continent: 'OT', name: region?.trim() || '未设置', lat: null, lng: null }
  return { code, continent: row[0] as ContinentCode, name: row[1], lat: row[2], lng: row[3] }
}

export function continentName(code: string) {
  return CONTINENTS.find((c) => c.code === code)?.name ?? code
}
