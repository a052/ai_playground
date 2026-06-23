import type { FetchedPage } from '@/types'
import { runHttp, safeReadText } from '@/lib/http'
import type { ToolContext, ToolExecResult } from '@/lib/toolContext'

/** Strip a data URL / normalize a candidate URL; ensure it has a scheme. */
function normalizeUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

/** Extract readable text from an HTML document using the browser DOM parser. */
function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script,style,noscript,svg,iframe,template').forEach(
      (el) => el.remove(),
    )
    const title = doc.title?.trim()
    const body = (doc.body?.textContent ?? '')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()
    return title ? `${title}\n\n${body}` : body
  } catch {
    return html
  }
}

/**
 * Read a single URL's text. Tries the Jina Reader (CORS-friendly, clean text),
 * then falls back to a direct fetch (with CORS-proxy fallback) + HTML→text.
 * Returns the page plus the HTTP transaction of whichever path produced it.
 */
export async function fetchPage(
  rawUrl: string,
  ctx: ToolContext,
): Promise<{ page: FetchedPage | null; transaction?: import('@/types').HttpTransaction; error?: string }> {
  const url = normalizeUrl(rawUrl)
  if (!url) return { page: null, error: 'No URL provided.' }
  const limit = ctx.searchSettings.maxPageChars

  // 1) Jina Reader — https://r.jina.ai/<url>
  const jina = await runHttp(
    {
      url: `https://r.jina.ai/${url}`,
      method: 'GET',
      headers: { Accept: 'text/plain' },
    },
    ctx.corsProxy,
    ctx.signal,
    'fetch',
  )
  if (jina.res && jina.res.ok) {
    const body = await safeReadText(jina.res)
    const { text, truncated } = truncate(body.trim(), limit)
    jina.tx.responseBody = text
    return {
      page: {
        url,
        text: truncated ? `${text}\n\n[Truncated to ${limit} chars]` : text,
        via: 'jina',
      },
      transaction: jina.tx,
    }
  }
  if (ctx.signal.aborted) return { page: null, transaction: jina.tx, error: 'Aborted.' }

  // 2) Direct fetch (+ CORS proxy fallback) → HTML to text.
  const direct = await runHttp(
    { url, method: 'GET', headers: { Accept: 'text/html,*/*' } },
    ctx.corsProxy,
    ctx.signal,
    'fetch',
  )
  if (direct.res && direct.res.ok) {
    const body = await safeReadText(direct.res)
    const ctype = direct.res.headers.get('content-type') ?? ''
    const extracted = ctype.includes('html') ? htmlToText(body) : body.trim()
    const { text, truncated } = truncate(extracted, limit)
    direct.tx.responseBody = text
    return {
      page: {
        url,
        text: truncated ? `${text}\n\n[Truncated to ${limit} chars]` : text,
        via: direct.tx.usedProxy ? 'proxy' : 'direct',
      },
      transaction: direct.tx,
    }
  }

  const error =
    direct.tx.error ??
    `HTTP ${direct.res?.status ?? jina.res?.status ?? '?'} when reading ${url}`
  return { page: null, transaction: direct.tx, error }
}

/** fetch_url tool executor. */
export async function runFetchUrl(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecResult> {
  const rawUrl = String(args.url ?? '').trim()
  if (!rawUrl) return { result: 'Error: no `url` argument provided.', error: 'no url' }

  const { page, transaction, error } = await fetchPage(rawUrl, ctx)
  if (!page) {
    return {
      result: `Failed to read ${rawUrl}: ${error ?? 'unknown error'}`,
      transaction,
      error,
    }
  }
  return { result: page.text, resultData: page, transaction }
}
