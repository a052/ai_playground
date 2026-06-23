import type { HttpTransaction } from '@/types'

// ---------------------------------------------------------------------------
// Shared HTTP layer: CORS-proxy fallback + transaction capture.
// Used by the chat API client AND the web-search / url-fetch tool executors so
// every outbound request goes through identical proxy logic and is inspectable.
// ---------------------------------------------------------------------------

export interface BuiltRequest {
  url: string
  /** Defaults to POST. GET/HEAD requests omit the body. */
  method?: string
  headers: Record<string, string>
  /** Object bodies are JSON-stringified; string bodies are sent as-is. */
  body?: Record<string, unknown> | string
}

export function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

export function formatHttpError(
  status: number,
  statusText: string,
  body: string,
): string {
  let detail = body
  try {
    const json = JSON.parse(body)
    detail = json?.error?.message ?? json?.message ?? body
  } catch {
    // keep raw
  }
  return `HTTP ${status} ${statusText}${detail ? ` — ${detail}` : ''}`
}

function serializeBody(body: BuiltRequest['body']): string | undefined {
  if (body === undefined || body === null) return undefined
  return typeof body === 'string' ? body : JSON.stringify(body)
}

/**
 * Fetch with a CORS-proxy fallback: try the direct URL first, and on a network
 * `TypeError` (typically CORS) retry through `corsProxy` when configured. The
 * transaction records whether the proxy was used and the effective URL.
 */
export async function fetchWithCorsFallback(
  built: BuiltRequest,
  corsProxy: string,
  signal: AbortSignal,
  tx: HttpTransaction,
): Promise<Response> {
  const method = (built.method ?? 'POST').toUpperCase()
  const init: RequestInit = { method, headers: built.headers, signal }
  if (method !== 'GET' && method !== 'HEAD') {
    const serialized = serializeBody(built.body)
    if (serialized !== undefined) init.body = serialized
  }

  try {
    return await fetch(built.url, init)
  } catch (err) {
    // Re-throw user aborts immediately.
    if (signal.aborted) throw err
    const isNetwork = err instanceof TypeError
    if (isNetwork && corsProxy) {
      console.warn(
        '[http] direct request failed (likely CORS); retrying via proxy',
        err,
      )
      const proxied = `${corsProxy}${built.url}`
      tx.effectiveUrl = proxied
      tx.usedProxy = true
      return await fetch(proxied, init)
    }
    throw err
  }
}

/**
 * Run a one-shot HTTP request and return a fully-populated `HttpTransaction`
 * alongside the `Response`. This is the single place that guarantees every tool
 * HTTP call (search API, Jina reader, proxy fetch) is inspectable. The caller
 * reads the body from the returned `Response`; `tx.responseBody` is filled here
 * only on error (so the caller can still stream/parse a successful body).
 */
export async function runHttp(
  built: BuiltRequest,
  corsProxy: string,
  signal: AbortSignal,
  apiType: HttpTransaction['apiType'],
): Promise<{ res: Response | null; tx: HttpTransaction }> {
  const method = (built.method ?? 'POST').toUpperCase()
  const tx: HttpTransaction = {
    apiType,
    requestMethod: method,
    requestUrl: built.url,
    effectiveUrl: built.url,
    requestHeaders: built.headers,
    requestBody:
      built.body === undefined
        ? ''
        : typeof built.body === 'string'
          ? built.body
          : JSON.stringify(built.body, null, 2),
    usedProxy: false,
    startedAt: Date.now(),
  }
  const start = performance.now()
  try {
    const res = await fetchWithCorsFallback(built, corsProxy, signal, tx)
    tx.responseStatus = res.status
    tx.responseStatusText = res.statusText
    tx.responseHeaders = headersToObject(res.headers)
    tx.durationMs = Math.round(performance.now() - start)
    return { res, tx }
  } catch (err) {
    tx.error = (err as Error).message
    tx.durationMs = Math.round(performance.now() - start)
    return { res: null, tx }
  }
}
