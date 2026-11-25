import { lazy } from 'react'

// lightweight-charts is only needed once a detail drawer opens. One lazy component for every
// chart of the page, so they load (and suspend) together.
export const KLineChart = lazy(() => import('./KLineChart'))
