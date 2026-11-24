// Minimal JSON-RPC 2.0 client for Komari's `/api/rpc2` endpoint (HTTP POST).

const ENDPOINT = `${import.meta.env.BASE_URL}api/rpc2`

export class RpcError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

interface RpcResponse<T> {
  id: number
  result?: T
  error?: { code: number; message: string }
}

let nextId = 1

/** Measured round-trip time of the latest request, shown in the status bar. */
export let lastLatency: number | null = null

async function post(body: unknown, signal?: AbortSignal) {
  const started = performance.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new RpcError(res.status, `HTTP ${res.status}`)
  const json = await res.json()
  lastLatency = performance.now() - started
  return json
}

function unwrap<T>(res: RpcResponse<T>): T {
  if (res.error) throw new RpcError(res.error.code, res.error.message)
  return res.result as T
}

export async function rpc<T>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  return unwrap(await post({ jsonrpc: '2.0', method, params, id: nextId++ }, signal))
}

/** Sends several calls in one HTTP request; results keep the call order. */
export async function rpcBatch<T extends unknown[]>(
  calls: { method: string; params?: Record<string, unknown> }[],
  signal?: AbortSignal,
): Promise<T> {
  const base = nextId
  nextId += calls.length
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', method: c.method, params: c.params ?? {}, id: base + i }))
  const res = (await post(body, signal)) as RpcResponse<unknown>[]
  const byId = new Map(res.map((r) => [r.id, r]))
  return calls.map((_, i) => unwrap(byId.get(base + i) ?? { id: 0, error: { code: -32603, message: 'missing response' } })) as T
}
