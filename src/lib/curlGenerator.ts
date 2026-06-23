import type { HttpTransaction } from '@/types'

/** Single-quote a value for POSIX shells, escaping embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Build a terminal-ready `curl` command that reproduces the captured request.
 * Uses the direct (non-proxied) URL so it runs without CORS concerns, and
 * keeps the Authorization / API-key headers so it works out of the box.
 */
export function generateCurl(tx: HttpTransaction): string {
  const method = tx.requestMethod || 'POST'
  const lines: string[] = []
  lines.push(`curl -X ${method} ${shellQuote(tx.requestUrl)}`)

  for (const [key, value] of Object.entries(tx.requestHeaders)) {
    lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`)
  }

  if (tx.requestBody && method !== 'GET' && method !== 'HEAD') {
    // Body is already a pretty-printed JSON string; compact it for the command.
    let body = tx.requestBody
    try {
      body = JSON.stringify(JSON.parse(tx.requestBody))
    } catch {
      // leave as-is if it is not valid JSON
    }
    lines.push(`  -d ${shellQuote(body)}`)
  }

  // For streaming endpoints `--no-buffer` gives live output in the terminal.
  lines.push('  --no-buffer')

  return lines.join(' \\\n')
}
