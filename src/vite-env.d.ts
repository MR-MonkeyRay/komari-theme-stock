/// <reference types="vite/client" />

declare module 'virtual:geo/countries' {
  /** ISO2 -> [continent, zhName, lat, lng] */
  const countries: Record<string, [string, string, number, number]>
  export default countries
}

declare module 'virtual:geo/world-map' {
  /** dotted-map precomputed grid (JSON string) */
  const map: string
  export default map
}
