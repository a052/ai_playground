/**
 * Return the URL if it uses an http(s) scheme; otherwise null.
 *
 * Use for any untrusted string that may become an <a href> or fetch target
 * (search-provider hits, tool args). React does not strip javascript: from href.
 */
export function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' || u.protocol === 'https:') return trimmed
    return null
  } catch {
    return null
  }
}
