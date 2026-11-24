import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { adminSettings, latestStatus, listClients, metricDefinitions, nodesInformation, publicSettings, queryMetrics } from './fixture.ts'

// `vite --mode mock` serves the Komari public API from the offline fixture
// instead of proxying to a backend. Never included in production builds.
//
// Login is simulated with a cookie: the theme's 登录 link (/admin/login) sets it and returns to
// the page, /__mock/logout clears it. Logged in, the fixture also returns the hidden node and the
// admin methods; as a guest, admin methods fail like Komari's (-32041 Permission denied).

interface RpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

const ADMIN_COOKIE = 'komari_mock_admin=1'
const ME_ADMIN = { logged_in: true, username: 'admin', uuid: '00000000-0000-4000-8000-000000000001', sso_id: '', sso_type: '', '2fa_enabled': false }
const ME_GUEST = { username: 'Guest', logged_in: false }

const isAdmin = (req: IncomingMessage) => (req.headers.cookie ?? '').split(/;\s*/).includes(ADMIN_COOKIE)

function call(req: RpcRequest, admin: boolean) {
  const p = (req.params ?? {}) as never
  if (req.method.startsWith('admin:') && !admin) throw Object.assign(new Error('Permission denied'), { code: -32041 })
  switch (req.method) {
    case 'public:getNodesInformation':
      return nodesInformation(admin)
    case 'common:getNodesLatestStatus':
      return latestStatus(admin)
    case 'public:queryMetrics':
      return queryMetrics(p, admin)
    case 'admin:listClients':
      return listClients()
    case 'admin:getSettings':
      return adminSettings
    case 'public:listMetricDefinitions':
      return metricDefinitions()
    case 'public:getPublicSettings':
      return publicSettings
    case 'public:getPublicPingTasks':
      return []
    case 'public:getMe':
      return admin ? ME_ADMIN : ME_GUEST
    case 'common:getVersion':
    case 'public:getVersion':
      return { version: '1.6.2', hash: 'mock' }
    default:
      throw Object.assign(new Error(`Method not found: ${req.method}`), { code: -32601 })
  }
}

function answer(req: RpcRequest, admin: boolean) {
  try {
    return { jsonrpc: '2.0', id: req.id, result: call(req, admin) }
  } catch (err) {
    const e = err as Error & { code?: number }
    return { jsonrpc: '2.0', id: req.id, error: { code: e.code ?? -32603, message: e.message } }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, body: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'komari-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === '/api/public') return json(res, { status: 'success', message: '', data: publicSettings })
        if (url.pathname === '/api/version') return json(res, { status: 'success', message: '', data: { version: '1.6.2', hash: 'mock' } })
        const admin = isAdmin(req)
        if (url.pathname === '/api/me') return json(res, admin ? ME_ADMIN : ME_GUEST)
        if (url.pathname === '/admin/login' || url.pathname === '/__mock/logout') {
          const login = url.pathname === '/admin/login'
          res.statusCode = 302
          res.setHeader('Set-Cookie', `${ADMIN_COOKIE}; Path=/; SameSite=Lax${login ? '' : '; Max-Age=0'}`)
          // Only same-site paths, like Komari's redirect parameter. Resolving it also rejects `/\host`
          // and percent-encodes what a header cannot carry.
          const back = new URL(url.searchParams.get('redirect') ?? '/', 'http://mock.invalid')
          res.setHeader('Location', back.origin === 'http://mock.invalid' ? back.pathname + back.search + back.hash : '/')
          return res.end()
        }
        if (url.pathname === '/api/rpc2' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as RpcRequest | RpcRequest[]
          // Small delay so loading states are visible in development.
          await new Promise((r) => setTimeout(r, 60))
          return json(res, Array.isArray(body) ? body.map((b) => answer(b, admin)) : answer(body, admin))
        }
        next()
      })
    },
  }
}
