import type {
  ApiConfig,
  Attachment,
  HttpTransaction,
  Message,
  ModelParameters,
  StreamCallbacks,
} from '@/types'
import { createThinkSplitter } from '@/lib/thinkSplitter'
import {
  formatDocText,
  mimeFromDataUrl,
  stripDataUrlPrefix,
} from '@/lib/utils'

interface BuiltRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface ChatRequest {
  config: ApiConfig
  parameters: ModelParameters
  messages: Message[]
  corsProxy: string
  signal: AbortSignal
  callbacks: StreamCallbacks
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function streamChat(req: ChatRequest): Promise<void> {
  const { config, callbacks, parameters } = req
  let built: BuiltRequest
  try {
    built = buildRequest(req)
  } catch (err) {
    callbacks.onError((err as Error).message)
    callbacks.onDone()
    return
  }

  const tx: HttpTransaction = {
    apiType: config.type,
    requestMethod: 'POST',
    requestUrl: built.url,
    effectiveUrl: built.url,
    requestHeaders: built.headers,
    requestBody: JSON.stringify(built.body, null, 2),
    usedProxy: false,
  }

  const start = performance.now()
  let res: Response

  try {
    res = await fetchWithCorsFallback(built, req.corsProxy, req.signal, tx)
  } catch (err) {
    tx.error = (err as Error).message
    tx.durationMs = Math.round(performance.now() - start)
    callbacks.onTransaction(tx)
    if (!req.signal.aborted) callbacks.onError(tx.error)
    callbacks.onDone()
    return
  }

  tx.responseStatus = res.status
  tx.responseStatusText = res.statusText
  tx.responseHeaders = headersToObject(res.headers)

  if (!res.ok) {
    const text = await safeReadText(res)
    tx.responseBody = text
    tx.durationMs = Math.round(performance.now() - start)
    callbacks.onTransaction(tx)
    callbacks.onError(formatHttpError(res.status, res.statusText, text))
    callbacks.onDone()
    return
  }

  // --- non-streaming: read the whole body and emit once -------------------
  if (!parameters.stream) {
    const text = await safeReadText(res)
    tx.responseBody = text
    tx.durationMs = Math.round(performance.now() - start)
    try {
      const json = JSON.parse(text)
      parseFinal(config.type, json, callbacks)
    } catch (err) {
      if (!req.signal.aborted) callbacks.onError((err as Error).message)
    }
    callbacks.onTransaction(tx)
    callbacks.onDone()
    return
  }

  // --- streaming: parse SSE -----------------------------------------------
  const splitter = createThinkSplitter(callbacks.onContent, callbacks.onReasoning)
  const handleEvent = pickEventHandler(config.type, callbacks, splitter)

  let raw = ''
  try {
    if (!res.body) throw new Error('Response has no body to stream.')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      raw += chunk
      buffer += chunk

      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          handleEvent(JSON.parse(data))
        } catch {
          // ignore keep-alive / non-JSON lines
        }
      }
    }
    splitter.end()
  } catch (err) {
    if (!req.signal.aborted) {
      tx.error = (err as Error).message
      callbacks.onError(tx.error)
    }
  } finally {
    tx.responseBody = raw
    tx.durationMs = Math.round(performance.now() - start)
    callbacks.onTransaction(tx)
    callbacks.onDone()
  }
}

// ---------------------------------------------------------------------------
// Fetch with CORS proxy fallback
// ---------------------------------------------------------------------------

async function fetchWithCorsFallback(
  built: BuiltRequest,
  corsProxy: string,
  signal: AbortSignal,
  tx: HttpTransaction,
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: built.headers,
    body: JSON.stringify(built.body),
    signal,
  }

  try {
    return await fetch(built.url, init)
  } catch (err) {
    // Re-throw user aborts immediately.
    if (signal.aborted) throw err
    const isNetwork = err instanceof TypeError
    if (isNetwork && corsProxy) {
      console.warn(
        '[apiClient] direct request failed (likely CORS); retrying via proxy',
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

// ---------------------------------------------------------------------------
// Request builders per provider
// ---------------------------------------------------------------------------

function buildRequest(req: ChatRequest): BuiltRequest {
  switch (req.config.type) {
    case 'openai':
      return buildOpenAI(req)
    case 'claude':
      return buildClaude(req)
    case 'gemini':
      return buildGemini(req)
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function parsedLogitBias(raw: string): Record<string, number> | undefined {
  if (!raw.trim()) return undefined
  try {
    const obj = JSON.parse(raw)
    return typeof obj === 'object' && obj !== null ? obj : undefined
  } catch {
    return undefined
  }
}

/**
 * Merge a user-typed JSON fragment into the request body. Accepts either a bare
 * key/value list (`"enable_thinking": true`) or a full object (`{ ... }`), and
 * tolerates stray leading/trailing commas — we parse into an object and merge,
 * so the serialized payload is always valid JSON regardless of comma placement.
 * Invalid fragments are skipped (the UI surfaces the parse error separately).
 */
function mergeJsonFragment(body: Record<string, unknown>, raw: string): void {
  let s = raw.trim()
  if (!s) return
  s = s.replace(/^,+/, '').replace(/,+\s*$/, '').trim()
  if (!s) return
  const candidate = s.startsWith('{') && s.endsWith('}') ? s : `{${s}}`
  try {
    const parsed = JSON.parse(candidate)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      Object.assign(body, parsed)
    }
  } catch {
    // Malformed fragment — skip injection rather than corrupt the request.
  }
}

// --- OpenAI-compatible ------------------------------------------------------

function buildOpenAI(req: ChatRequest): BuiltRequest {
  const { config, parameters: p } = req
  const url = `${trimSlash(config.baseUrl)}/chat/completions`

  const messages: unknown[] = []
  if (p.systemPrompt.trim()) {
    messages.push({ role: 'system', content: p.systemPrompt })
  }
  for (const m of req.messages) {
    messages.push(openAIMessage(m))
  }

  const en = p.enabled
  const reasoning = en.reasoningEffort
  // Custom reasoning targets non-OpenAI models whose thinking params vary; the
  // official `reasoning_effort` path strips sampling params, the custom path
  // leaves them to the user.
  const customReasoning = reasoning && p.reasoningCustomEnabled
  const stripSampling = reasoning && !p.reasoningCustomEnabled
  const body: Record<string, unknown> = { model: config.modelId, messages }
  if (p.stream) body.stream = true
  if (customReasoning) mergeJsonFragment(body, p.reasoningCustom)
  else if (reasoning) body.reasoning_effort = p.reasoningEffort
  if (en.maxCompletionTokens) body.max_completion_tokens = p.maxCompletionTokens
  if (en.temperature && !stripSampling) body.temperature = p.temperature
  if (en.topP && !stripSampling) body.top_p = p.topP
  if (en.topK && !stripSampling && p.topK != null) body.top_k = p.topK
  if (en.presencePenalty && !stripSampling)
    body.presence_penalty = p.presencePenalty
  if (en.frequencyPenalty && !stripSampling)
    body.frequency_penalty = p.frequencyPenalty
  if (en.n) body.n = p.n
  if (en.stopSequences && p.stopSequences.length) body.stop = p.stopSequences
  if (en.seed && p.seed != null) body.seed = p.seed
  if (en.responseFormat && p.responseFormat === 'json_object')
    body.response_format = { type: 'json_object' }
  if (en.logitBias) {
    const lb = parsedLogitBias(p.logitBias)
    if (lb) body.logit_bias = lb
  }

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  }
}

function openAIMessage(m: Message) {
  const atts = m.attachments ?? []
  if (atts.length === 0) {
    return { role: m.role, content: m.content }
  }
  const parts: unknown[] = []
  if (m.content) parts.push({ type: 'text', text: m.content })
  for (const a of atts) {
    if (a.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
    } else if (a.kind === 'audio') {
      parts.push({
        type: 'input_audio',
        input_audio: {
          data: stripDataUrlPrefix(a.dataUrl),
          format: a.mimeType.includes('wav') ? 'wav' : 'mp3',
        },
      })
    } else if (a.kind === 'document') {
      if (isTextDoc(a)) {
        parts.push({ type: 'text', text: formatDocText(a.name, a.text ?? '') })
      } else {
        // Native PDF via file content part.
        parts.push({
          type: 'file',
          file: { filename: a.name, file_data: a.dataUrl },
        })
      }
    } else {
      parts.push({ type: 'text', text: `[Attached ${a.kind}: ${a.name}]` })
    }
  }
  return { role: m.role, content: parts }
}

// --- Claude (Anthropic) -----------------------------------------------------

function buildClaude(req: ChatRequest): BuiltRequest {
  const { config, parameters: p } = req
  const url = `${trimSlash(config.baseUrl)}/messages`

  const messages = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: claudeContent(m),
  }))

  const en = p.enabled
  const thinking = en.claudeThinking

  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: p.maxCompletionTokens,
    messages,
  }
  if (p.stream) body.stream = true
  if (p.systemPrompt.trim()) body.system = p.systemPrompt
  if (en.stopSequences && p.stopSequences.length)
    body.stop_sequences = p.stopSequences

  if (thinking) {
    // Adaptive thinking is the current API (budget_tokens is deprecated and 400s
    // on Opus 4.8/4.7). Depth is controlled via output_config.effort.
    // `display: summarized` keeps thinking text visible (newer models default to
    // omitted). Sampling params (temperature/top_p/top_k) are incompatible with
    // thinking and must be omitted entirely.
    body.thinking = { type: 'adaptive', display: 'summarized' }
    body.output_config = { effort: p.claudeEffort }
  } else {
    if (en.temperature) body.temperature = p.temperature
    if (en.topP) body.top_p = p.topP
    if (en.topK && p.topK != null) body.top_k = p.topK
  }

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  }
}

function claudeContent(m: Message) {
  const atts = m.attachments ?? []
  if (atts.length === 0) return m.content
  const blocks: unknown[] = []
  if (m.content) blocks.push({ type: 'text', text: m.content })
  for (const a of atts) {
    if (a.kind === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: a.mimeType || mimeFromDataUrl(a.dataUrl),
          data: stripDataUrlPrefix(a.dataUrl),
        },
      })
    } else if (a.kind === 'document') {
      if (isTextDoc(a)) {
        blocks.push({ type: 'text', text: formatDocText(a.name, a.text ?? '') })
      } else {
        // Native PDF document block.
        blocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: stripDataUrlPrefix(a.dataUrl),
          },
        })
      }
    } else {
      blocks.push({ type: 'text', text: `[Attached ${a.kind}: ${a.name}]` })
    }
  }
  return blocks
}

// --- Gemini -----------------------------------------------------------------

function buildGemini(req: ChatRequest): BuiltRequest {
  const { config, parameters: p } = req
  const method = p.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const url = `${trimSlash(config.baseUrl)}/models/${config.modelId}:${method}`

  const contents = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: geminiParts(m),
  }))

  const en = p.enabled
  const generationConfig: Record<string, unknown> = {}
  if (en.temperature) generationConfig.temperature = p.temperature
  if (en.maxCompletionTokens)
    generationConfig.maxOutputTokens = p.maxCompletionTokens
  if (en.topP) generationConfig.topP = p.topP
  if (en.topK && p.topK != null) generationConfig.topK = p.topK
  if (en.stopSequences && p.stopSequences.length)
    generationConfig.stopSequences = p.stopSequences
  if (en.seed && p.seed != null) generationConfig.seed = p.seed
  if (en.responseFormat && p.responseFormat === 'json_object')
    generationConfig.responseMimeType = 'application/json'
  if (en.geminiThinkingLevel) {
    generationConfig.thinkingConfig = {
      thinkingLevel: p.geminiThinkingLevel,
      includeThoughts: true,
    }
  }

  const body: Record<string, unknown> = { contents, generationConfig }
  if (p.systemPrompt.trim()) {
    body.systemInstruction = { parts: [{ text: p.systemPrompt }] }
  }

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body,
  }
}

function geminiParts(m: Message) {
  const parts: unknown[] = []
  if (m.content) parts.push({ text: m.content })
  for (const a of m.attachments ?? []) {
    if (a.kind === 'document' && isTextDoc(a)) {
      parts.push({ text: formatDocText(a.name, a.text ?? '') })
    } else {
      // image / audio / video / native PDF → inline base64 data.
      parts.push({
        inlineData: {
          mimeType: a.mimeType || mimeFromDataUrl(a.dataUrl),
          data: stripDataUrlPrefix(a.dataUrl),
        },
      })
    }
  }
  if (parts.length === 0) parts.push({ text: '' })
  return parts
}

/** A document attachment carrying extracted text (vs. a native PDF/base64). */
function isTextDoc(a: Attachment): boolean {
  return a.kind === 'document' && typeof a.text === 'string'
}

// ---------------------------------------------------------------------------
// Provider response shapes (loosely typed; field values validated at use site)
// ---------------------------------------------------------------------------

interface OpenAIDelta {
  role?: string
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
}
interface OpenAIResponse {
  choices?: Array<{ delta?: OpenAIDelta; message?: OpenAIDelta }>
}

interface ClaudeStreamEvent {
  type?: string
  delta?: { type?: string; text?: string; thinking?: string }
  error?: { message?: string }
}
interface ClaudeResponse {
  content?: Array<{ type?: string; text?: string; thinking?: string }>
}

interface GeminiPart {
  text?: unknown
  thought?: unknown
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
}

// ---------------------------------------------------------------------------
// Streaming SSE event handlers per provider
// ---------------------------------------------------------------------------

function pickEventHandler(
  type: ApiConfig['type'],
  cb: StreamCallbacks,
  splitter: ReturnType<typeof createThinkSplitter>,
) {
  if (type === 'claude') return makeClaudeHandler(cb)
  if (type === 'gemini') return makeGeminiHandler(cb)
  return makeOpenAIHandler(cb, splitter)
}

function makeOpenAIHandler(
  cb: StreamCallbacks,
  splitter: ReturnType<typeof createThinkSplitter>,
) {
  return (json: OpenAIResponse) => {
    const choice = json?.choices?.[0]
    if (!choice) return
    const delta: OpenAIDelta = choice.delta ?? choice.message ?? {}
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) cb.onReasoning(reasoning)
    if (typeof delta.content === 'string' && delta.content) {
      splitter.push(delta.content)
    }
  }
}

function makeClaudeHandler(cb: StreamCallbacks) {
  return (json: ClaudeStreamEvent) => {
    if (json?.type === 'content_block_delta') {
      const d = json.delta
      if (d?.type === 'text_delta' && d.text) cb.onContent(d.text)
      else if (d?.type === 'thinking_delta' && d.thinking)
        cb.onReasoning(d.thinking)
    } else if (json?.type === 'error') {
      cb.onError(json.error?.message ?? 'Anthropic stream error')
    }
  }
}

function makeGeminiHandler(cb: StreamCallbacks) {
  return (json: GeminiResponse) => {
    const parts = json?.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) return
    for (const part of parts) {
      if (typeof part?.text !== 'string') continue
      if (part.thought) cb.onReasoning(part.text)
      else cb.onContent(part.text)
    }
  }
}

// ---------------------------------------------------------------------------
// Non-streaming final-response parsers per provider
// ---------------------------------------------------------------------------

function parseFinal(
  type: ApiConfig['type'],
  json: ClaudeResponse & GeminiResponse & OpenAIResponse,
  cb: StreamCallbacks,
) {
  if (type === 'claude') {
    const blocks = json?.content
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b?.type === 'text' && b.text) cb.onContent(b.text)
        else if (b?.type === 'thinking' && b.thinking) cb.onReasoning(b.thinking)
      }
    }
    return
  }
  if (type === 'gemini') {
    const parts = json?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part?.text !== 'string') continue
        if (part.thought) cb.onReasoning(part.text)
        else cb.onContent(part.text)
      }
    }
    return
  }
  // OpenAI-compatible — route content through the <think> splitter.
  const msg: OpenAIDelta = json?.choices?.[0]?.message ?? {}
  const reasoning = msg.reasoning_content ?? msg.reasoning
  if (typeof reasoning === 'string' && reasoning) cb.onReasoning(reasoning)
  if (typeof msg.content === 'string' && msg.content) {
    const splitter = createThinkSplitter(cb.onContent, cb.onReasoning)
    splitter.push(msg.content)
    splitter.end()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function formatHttpError(status: number, statusText: string, body: string) {
  let detail = body
  try {
    const json = JSON.parse(body)
    detail = json?.error?.message ?? json?.message ?? body
  } catch {
    // keep raw
  }
  return `HTTP ${status} ${statusText}${detail ? ` — ${detail}` : ''}`
}
