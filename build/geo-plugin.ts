import { createRequire } from 'node:module'
import { getMapJSON } from 'dotted-map'
import type { Plugin } from 'vite'
import type { Countries } from 'world-countries'

const countries = createRequire(import.meta.url)('world-countries/countries.json') as Countries

// Build-time extraction from world-countries (1.4 MB JSON) and dotted-map,
// so the bundle only carries what the theme actually reads.
//   virtual:geo/countries -> { [ISO2]: [continent, zhName, lat, lng] }
//   virtual:geo/world-map -> precomputed dotted-map grid (lazy loaded by the map panel)

const COUNTRIES_ID = 'virtual:geo/countries'
const MAP_ID = 'virtual:geo/world-map'

function continentOf(region: string, subregion: string): string {
  switch (region) {
    case 'Asia':
      return 'AS'
    case 'Europe':
      return 'EU'
    case 'Africa':
      return 'AF'
    case 'Oceania':
      return 'OC'
    case 'Antarctic':
      return 'AN'
    case 'Americas':
      return subregion === 'South America' ? 'SA' : 'NA'
    default:
      return 'OT'
  }
}

export function geoPlugin(): Plugin {
  return {
    name: 'komari-theme-geo',
    resolveId(id) {
      if (id === COUNTRIES_ID || id === MAP_ID) return '\0' + id
    },
    load(id) {
      if (id === '\0' + COUNTRIES_ID) {
        const table: Record<string, [string, string, number, number]> = {}
        for (const c of countries) {
          const zh = c.translations?.zho?.common ?? c.name.common
          table[c.cca2] = [continentOf(c.region, c.subregion), zh, c.latlng[0], c.latlng[1]]
        }
        return `export default ${JSON.stringify(table)}`
      }
      if (id === '\0' + MAP_ID) {
        const json = getMapJSON({ height: 46, grid: 'diagonal' })
        return `export default ${JSON.stringify(json)}`
      }
    },
  }
}
