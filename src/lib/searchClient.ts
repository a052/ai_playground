import type { SearchConfig, SearchProvider, SearchResult } from '@/types'
import { runHttp, safeReadText, type BuiltRequest } from '@/lib/http'
import { fetchPage } from '@/lib/urlFetcher'
import type { ToolContext, ToolExecResult } from '@/lib/toolContext'

/** Default endpoints per provider (overridable via SearchConfig.baseUrl). */
const DEFAULT_ENDPOINT: Record<SearchProvider, string> = {
  tavily: 'https://api.tavily.com/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
  serper: 'https://google.serper.dev/search',
  exa: 'https://api.exa.ai/search',
  custom: '',
}

interface AdapterCtx {
  maxResults: number
}

interface SearchAdapter {
  buildRequest: (query: string, cfg: SearchConfig, ctx: AdapterCtx) => BuiltRequest
  parseResults: (json: unknown, cfg: SearchConfig) => SearchResult[]
}

function endpoint(cfg: SearchConfig): string {
  return (cfg.baseUrl?.trim() || DEFAULT_ENDPOINT[cfg.provider]).replace(/\/+$/, '')
}

/** Parse the optional extra-params JSON fragment into a plain object. */
function parseExtra(cfg: SearchConfig): Record<string, unknown> {
  if (!cfg.extraParams?.trim()) return {}
  try {
    const obj = JSON.parse(cfg.extraParams)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// --- adapters ---------------------------------------------------------------

const tavily: SearchAdapter = {
  buildRequest: (query, cfg, ctx) => ({
    url: endpoint(cfg),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: {
      query,
      max_results: ctx.maxResults,
      search_depth: 'basic',
      ...parseExtra(cfg),
    },
  }),
  parseResults: (json) => {
    const results = isObj(json) && Array.isArray(json.results) ? json.results : []
    return results.filter(isObj).map((r) => ({
      title: asString(r.title) || asString(r.url),
      url: asString(r.url),
      snippet: asString(r.content),
      publishedAt: asString(r.published_date) || undefined,
    }))
  },
}

const brave: SearchAdapter = {
  buildRequest: (query, cfg, ctx) => {
    const params = new URLSearchParams({
      q: query,
      count: String(ctx.maxResults),
    })
    for (const [k, v] of Object.entries(parseExtra(cfg)))
      params.set(k, String(v))
    return {
      url: `${endpoint(cfg)}?${params.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': cfg.apiKey,
      },
    }
  },
  parseResults: (json) => {
    const web = isObj(json) && isObj(json.web) ? json.web : undefined
    const results = web && Array.isArray(web.results) ? web.results : []
    return results.filter(isObj).map((r) => ({
      title: asString(r.title),
      url: asString(r.url),
      snippet: asString(r.description),
      publishedAt: asString(r.age) || undefined,
    }))
  },
}

const serper: SearchAdapter = {
  buildRequest: (query, cfg, ctx) => ({
    url: endpoint(cfg),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': cfg.apiKey,
    },
    body: { q: query, num: ctx.maxResults, ...parseExtra(cfg) },
  }),
  parseResults: (json) => {
    const organic = isObj(json) && Array.isArray(json.organic) ? json.organic : []
    return organic.filter(isObj).map((r) => ({
      title: asString(r.title),
      url: asString(r.link),
      snippet: asString(r.snippet),
      publishedAt: asString(r.date) || undefined,
    }))
  },
}

const exa: SearchAdapter = {
  buildRequest: (query, cfg, ctx) => ({
    url: endpoint(cfg),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
    },
    body: {
      query,
      numResults: ctx.maxResults,
      contents: { text: { maxCharacters: 2000 } },
      ...parseExtra(cfg),
    },
  }),
  parseResults: (json) => {
    const results = isObj(json) && Array.isArray(json.results) ? json.results : []
    return results.filter(isObj).map((r) => {
      const text = asString(r.text)
      return {
        title: asString(r.title) || asString(r.url),
        url: asString(r.url),
        snippet: asString(r.snippet) || text.slice(0, 500),
        content: text || undefined,
        publishedAt: asString(r.publishedDate) || undefined,
      }
    })
  },
}

/** Generic adapter: POST { query, ...extra }; best-effort response parsing. */
const custom: SearchAdapter = {
  buildRequest: (query, cfg) => ({
    url: endpoint(cfg),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: { query, q: query, ...parseExtra(cfg) },
  }),
  parseResults: (json) => parseGeneric(json),
}

/** Best-effort extraction of result-like arrays from an unknown JSON shape. */
function parseGeneric(json: unknown): SearchResult[] {
  let arr: unknown[] = []
  if (isObj(json)) {
    const candidate =
      (Array.isArray(json.results) && json.results) ||
      (Array.isArray(json.organic) && json.organic) ||
      (Array.isArray(json.data) && json.data) ||
      (Array.isArray(json.items) && json.items) ||
      (isObj(json.web) && Array.isArray(json.web.results) && json.web.results) ||
      []
    arr = candidate as unknown[]
  } else if (Array.isArray(json)) {
    arr = json
  }
  return arr.filter(isObj).map((r) => ({
    title: asString(r.title) || asString(r.name) || asString(r.url ?? r.link),
    url: asString(r.url) || asString(r.link),
    snippet:
      asString(r.snippet) ||
      asString(r.content) ||
      asString(r.description) ||
      asString(r.text),
  }))
}

const ADAPTERS: Record<SearchProvider, SearchAdapter> = {
  tavily,
  brave,
  serper,
  exa,
  custom,
}

function resolveConfig(ctx: ToolContext): SearchConfig | undefined {
  const { searchConfigs, searchSettings } = ctx
  return (
    searchConfigs.find((c) => c.id === searchSettings.activeConfigId) ??
    searchConfigs[0]
  )
}

/** Format the structured results into the text fed back to the model. */
function formatResults(results: SearchResult[]): string {
  if (!results.length) return 'No results found.'
  return results
    .map((r, i) => {
      const lines = [`[${i + 1}] ${r.title}`, `URL: ${r.url}`]
      if (r.publishedAt) lines.push(`Date: ${r.publishedAt}`)
      const body = r.content ?? r.snippet
      if (body) lines.push(body.slice(0, 1500))
      return lines.join('\n')
    })
    .join('\n\n')
}

/** web_search tool executor. */
export async function runWebSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecResult> {
  const cfg = resolveConfig(ctx)
  if (!cfg) {
    return {
      result: 'Error: no web-search provider is configured.',
      error: 'no search config',
    }
  }
  const query = String(args.query ?? args.q ?? '').trim()
  if (!query) {
    return { result: 'Error: no `query` argument provided.', error: 'no query' }
  }

  const adapter = ADAPTERS[cfg.provider] ?? custom
  const built = adapter.buildRequest(query, cfg, {
    maxResults: ctx.searchSettings.maxResults,
  })

  const { res, tx } = await runHttp(built, ctx.corsProxy, ctx.signal, 'search')
  if (!res) {
    return {
      result: `Search request failed: ${tx.error ?? 'network error'}`,
      transaction: tx,
      error: tx.error,
    }
  }

  const text = await safeReadText(res)
  tx.responseBody = text
  if (!res.ok) {
    return {
      result: `Search failed (HTTP ${res.status}): ${text.slice(0, 500)}`,
      transaction: tx,
      error: `HTTP ${res.status}`,
    }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return {
      result: `Search returned non-JSON response.`,
      transaction: tx,
      error: 'invalid JSON',
    }
  }

  let results = adapter.parseResults(json, cfg).slice(0, ctx.searchSettings.maxResults)

  // Optional: auto-fetch the top-N result pages and embed their content.
  if (ctx.searchSettings.depth === 'fetch_top_n' && ctx.searchSettings.topN > 0) {
    const n = Math.min(ctx.searchSettings.topN, results.length)
    const fetched = await Promise.all(
      results.slice(0, n).map(async (r) => {
        if (ctx.signal.aborted || !r.url) return r
        const { page } = await fetchPage(r.url, ctx)
        return page ? { ...r, content: page.text } : r
      }),
    )
    results = [...fetched, ...results.slice(n)]
  }

  return {
    result: formatResults(results),
    resultData: results,
    transaction: tx,
  }
}
