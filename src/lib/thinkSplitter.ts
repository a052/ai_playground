/**
 * Streaming splitter that routes text inside `<think>…</think>` blocks to a
 * reasoning callback and everything else to a content callback. Handles tags
 * that are split across streaming chunks.
 */
const OPEN = '<think>'
const CLOSE = '</think>'

/** Longest suffix of `s` that is a proper prefix of `tag`. */
function tailPartial(s: string, tag: string): string {
  const max = Math.min(s.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (tag.startsWith(s.slice(s.length - len))) return s.slice(s.length - len)
  }
  return ''
}

export interface ThinkSplitter {
  push: (text: string) => void
  /** Flush any held-back partial tag as content. */
  end: () => void
}

export function createThinkSplitter(
  onContent: (text: string) => void,
  onReasoning: (text: string) => void,
): ThinkSplitter {
  let inside = false
  let carry = ''

  function push(text: string) {
    let s = carry + text
    carry = ''
    while (s.length) {
      if (!inside) {
        const i = s.indexOf(OPEN)
        if (i === -1) {
          const keep = tailPartial(s, OPEN)
          const emit = s.slice(0, s.length - keep.length)
          if (emit) onContent(emit)
          carry = keep
          return
        }
        if (i > 0) onContent(s.slice(0, i))
        s = s.slice(i + OPEN.length)
        inside = true
      } else {
        const i = s.indexOf(CLOSE)
        if (i === -1) {
          const keep = tailPartial(s, CLOSE)
          const emit = s.slice(0, s.length - keep.length)
          if (emit) onReasoning(emit)
          carry = keep
          return
        }
        if (i > 0) onReasoning(s.slice(0, i))
        s = s.slice(i + CLOSE.length)
        inside = false
      }
    }
  }

  function end() {
    if (carry) {
      if (inside) onReasoning(carry)
      else onContent(carry)
      carry = ''
    }
  }

  return { push, end }
}
