import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { geoPlugin } from './build/geo-plugin.ts'
import { mockApiPlugin } from './mock/plugin.ts'

// Komari serves the active theme's dist/ at the site root, so assets use an
// absolute base. VITE_BASE_URL is only needed when Komari runs under a sub-path.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://127.0.0.1:25774'
  const mock = mode === 'mock'

  return {
    base: env.VITE_BASE_URL || '/',
    plugins: [react(), geoPlugin(), mock && mockApiPlugin()],
    server: {
      host: env.VITE_HOST || '127.0.0.1',
      proxy: mock
        ? undefined
        : {
            '/api': {
              target: apiTarget,
              changeOrigin: true,
              ws: true,
              rewriteWsOrigin: true,
              // Komari rejects cross-origin POSTs when its origin check is on; the
              // deployed theme is same-origin, so drop the dev server's Origin here.
              configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
            },
            '/themes': { target: apiTarget, changeOrigin: true },
          },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      chunkSizeWarningLimit: 800,
      // Keep flag SVGs as separate files so only the flags on screen are fetched.
      assetsInlineLimit: (file: string) => (file.includes('flag-icons') ? false : undefined),
    },
  }
})
