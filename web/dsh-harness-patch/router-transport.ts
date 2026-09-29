/**
 * Agent Router transport — implements the Connection `ClientConnectionRpc`
 * contract (call + open) against the local Agent Router console server
 * (default http://127.0.0.1:2288), so the official dsh Web UI renders
 * sessions fed by the Agent Router's per-agent thread journals.
 *
 * Installed as `globalThis.__DSH_TRANSPORT__` before the connection plugin
 * activates (`packages/client/connection/src/client/index.ts` prefers
 * `transport.rpc` over the default fetch/WebSocket carrier, and the gateway
 * client skips its WebSocket mux when `rpc.open` exists).
 */

const BASE: string = new URLSearchParams(location.search).get('routerBase')
  ?? localStorage.getItem('dsh-router-base')
  ?? 'http://127.0.0.1:2288'

interface ConnectionRpcResult {
  ok: boolean
  value?: unknown
  error?: { code: string, message: string, details: object }
}

async function call(
  _channel: string,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ConnectionRpcResult> {
  const res = await fetch(`${BASE}/dsh-api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    ...(signal === undefined ? {} : { signal }),
  })
  return await res.json() as ConnectionRpcResult
}

async function* open(
  _channel: string,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const res = await fetch(`${BASE}/dsh-api-stream/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    signal,
  })
  if (!res.body) throw new Error('router transport: stream response has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed !== '') yield JSON.parse(trimmed) as unknown
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Probe the router server; when reachable, install the transport global. */
export async function installRouterTransport(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/dsh-api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return false
    const globals = globalThis as { __DSH_TRANSPORT__?: unknown }
    globals.__DSH_TRANSPORT__ = {
      ownsHost: true,
      rpc: {
        call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) =>
          call(channel, endpoint, payload, signal),
        open: (channel: string, endpoint: string, payload: unknown, signal: AbortSignal) =>
          open(channel, endpoint, payload, signal),
      },
    }
    console.info(`[agent-router] transport installed → ${BASE}`)
    return true
  } catch {
    console.info('[agent-router] router server unreachable; using default dsh transport')
    return false
  }
}
