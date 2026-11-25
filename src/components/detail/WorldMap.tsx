import DottedMap from 'dotted-map/without-countries'
import worldMap from 'virtual:geo/world-map'

// Loaded lazily by the detail panel. The dotted grid is precomputed at build time.
const map = new DottedMap({ map: JSON.parse(worldMap) })
const svg = map
  .getSVG({ shape: 'circle', radius: 0.24, color: 'currentColor', backgroundColor: 'transparent' })
  .replace('<svg ', '<svg aria-hidden="true" preserveAspectRatio="xMidYMid meet" ')
const { width, height } = map.image

export default function WorldMap({ lat, lng, online }: { lat: number | null; lng: number | null; online: boolean }) {
  const pin = lat !== null && lng !== null ? map.getPin({ lat, lng }) : undefined
  return (
    // The map's height-to-width ratio, for the CSS that sizes the box to fit it whole.
    <div className="world-map" style={{ '--map-ratio': height / width } as React.CSSProperties}>
      <div className="world-dots" dangerouslySetInnerHTML={{ __html: svg }} />
      {pin && (
        <svg className="world-pins" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <circle className={online ? 'pin-halo' : 'pin-halo is-off'} cx={pin.x} cy={pin.y} r="1.6" />
          {/* The pulse means "reporting now"; an offline node keeps a still, grey pin. */}
          {online && <circle className="pin-ring" cx={pin.x} cy={pin.y} r="3" />}
          <circle className={online ? 'pin-on' : 'pin-off'} cx={pin.x} cy={pin.y} r="1" />
        </svg>
      )}
    </div>
  )
}
