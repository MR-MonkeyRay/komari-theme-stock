import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { latestStatus, metricDefinitions, nodesInformation, publicSettings, queryMetrics } from './fixture.ts'

// `vite --mode mock` serves the Komari public API from the offline fixture
// instead of proxying to a backend. Never included in production builds.

interface RpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

function call(req: RpcRequest) {
  const p = (req.params ?? {}) as never
  switch (req.method) {
    case 'public:getNodesInformation':
      return nodesInformation()
    case 'common:getNodesLatestStatus':
      return latestStatus()
    case 'public:queryMetrics':
      return queryMetrics(p)
    case 'public:listMetricDefinitions':
      return metricDefinitions()
    case 'public:getPublicSettings':
      return publicSettings
    case 'public:getPublicPingTasks':
      return []
    case 'common:getVersion':
    case 'public:getVersion':
      return { version: '1.6.2', hash: 'mock' }
    default:
      throw Object.assign(new Error(`Method not found: ${req.method}`), { code: -32601 })
  }
}

function answer(req: RpcRequest) {
  try {
    return { jsonrpc: '2.0', id: req.id, result: call(req) }
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
        if (url.pathname === '/api/me') return json(res, { username: 'Guest', logged_in: false })
        if (url.pathname === '/api/rpc2' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as RpcRequest | RpcRequest[]
          // Small delay so loading states are visible in development.
          await new Promise((r) => setTimeout(r, 60))
          return json(res, Array.isArray(body) ? body.map(answer) : answer(body))
        }
        next()
      })
    },
  }
}
