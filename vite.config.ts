import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Komari serves the active theme's dist/ at the site root, so assets use an
// absolute base. VITE_BASE_URL is only needed when Komari runs under a sub-path.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || 'http://127.0.0.1:25774'

  return {
    base: env.VITE_BASE_URL || '/',
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, ws: true, rewriteWsOrigin: true },
        '/themes': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  }
})
