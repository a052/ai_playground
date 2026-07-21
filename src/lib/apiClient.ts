import type {
  ApiConfig,
  Attachment,
  HttpTransaction,
  Message,
  ModelParameters,
  ParsedToolCall,
  StreamCallbacks,
  StreamResult,
  ToolCall,
  ToolDef,
  ToolRound,
} from '@/types'
import { createThinkSplitter } from '@/lib/thinkSplitter'
import {
  formatDocText,
  mimeFromDataUrl,
  stripDataUrlPrefix,
  uid,
} from '@/lib/utils'
import {
  fetchWithCorsFallback,
  formatHttpError,
  headersToObject,
  safeReadText,
  type BuiltRequest,
} from '@/lib/http'

export interface ChatRequest {
  config: ApiConfig
  parameters: ModelParameters
  messages: Message[]
  corsProxy: string
  signal: AbortSignal
  callbacks: StreamCallbacks
  /** Tool definitions exposed to the model (native function calling). */
  tools?: ToolDef[]
  /** When true, skip native tools (the orchestrator uses a ReAct prompt). */
  promptToolMode?: boolean
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function streamChat(req: ChatRequest): Promise<StreamResult> {
  const { config, callbacks, parameters } = req
  let built: BuiltRequest
  try {
    built = buildRequest(req)
  } catch (err) {
    callbacks.onError((err as Error).message)
    callbacks.onDone()
    return { finish: 'error' }
  }

  const tx: HttpTransaction = {
    apiType: config.type,
    requestMethod: 'POST',
    requestUrl: built.url,
    effectiveUrl: built.url,
    requestHeaders: built.headers,
    requestBody: JSON.stringify(built.body, null, 2),
    usedProxy: false,
    startedAt: Date.now(),
  }

  const start = performance.now()
  let res: Response

  try {
    res = await fetchWithCorsFallback(built, req.corsProxy, req.signal, tx)
  } catch (err) {
    tx.error = (err as Error).message
    tx.durationMs = Math.round(performance.now() - start)
    callbacks.onTransaction(tx)
    const aborted = req.signal.aborted
    if (!aborted) callbacks.onError(tx.error)
    callbacks.onDone()
    return { finish: aborted ? 'aborted' : 'error' }
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
    return { finish: 'error', errorStatus: res.status }
  }

  // --- non-streaming: read the whole body and emit once -------------------
  if (!parameters.stream) {
    const text = await safeReadText(res)
    tx.responseBody = text
    tx.durationMs = Math.round(performance.now() - start)
    let toolCalls: ParsedToolCall[] | null = null
    try {
      // Some endpoints ignore stream:false and return an SSE-framed body
      // (`data:{...}` lines). Detect that and parse it via the streaming
      // handlers instead of failing on JSON.parse.
      const isSse = text.trimStart().startsWith('data:')
      toolCalls = isSse
        ? parseSseFinal(config.type, text, callbacks)
        : parseFinal(config.type, JSON.parse(text), callbacks)
    } catch (err) {
      if (!req.signal.aborted) callbacks.onError((err as Error).message)
    }
    callbacks.onTransaction(tx)
    if (toolCalls && toolCalls.length) {
      callbacks.onToolCalls?.(toolCalls)
      callbacks.onDone()
      return { finish: 'tool_calls', toolCalls }
    }
    callbacks.onDone()
    return { finish: 'stop' }
  }

  // --- streaming: parse SSE -----------------------------------------------
  const splitter = createThinkSplitter(callbacks.onContent, callbacks.onReasoning)
  const handler = pickEventHandler(config.type, callbacks, splitter)

  let raw = ''
  let streamError = false
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
          handler.handle(JSON.parse(data))
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
      streamError = true
    }
  } finally {
    tx.responseBody = raw
    tx.durationMs = Math.round(performance.now() - start)
    callbacks.onTransaction(tx)
    callbacks.onDone()
  }

  if (req.signal.aborted) return { finish: 'aborted' }
  if (streamError) return { finish: 'error' }
  const { toolCalls } = handler.finalize()
  if (toolCalls.length) {
    callbacks.onToolCalls?.(toolCalls)
    return { finish: 'tool_calls', toolCalls }
  }
  return { finish: 'stop' }
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

function nativeToolsEnabled(req: ChatRequest): boolean {
  return !!req.tools?.length && !req.promptToolMode
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
    if (m.role === 'assistant' && m.toolRounds?.length) {
      for (const wire of openAIToolMessages(m)) messages.push(wire)
    } else {
      messages.push(openAIMessage(m))
    }
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
  if (nativeToolsEnabled(req)) {
    body.tools = req.tools!.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
    body.tool_choice = 'auto'
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

/** Expand an assistant message's tool rounds into OpenAI wire messages. */
function openAIToolMessages(m: Message): unknown[] {
  const out: unknown[] = []
  for (const round of m.toolRounds ?? []) {
    if (round.native) {
      out.push({
        role: 'assistant',
        content: round.content || null,
        tool_calls: round.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.argsRaw ?? JSON.stringify(tc.args),
          },
        })),
      })
      for (const tc of round.toolCalls) {
        out.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: tc.result ?? toolErrorText(tc),
        })
      }
    } else {
      out.push({ role: 'assistant', content: reactActionText(round) })
      out.push({ role: 'user', content: reactObservationText(round) })
    }
  }
  // Final answer turn. Omitted while the turn is still in progress (empty
  // content) so the tool results stay last and the model continues.
  if (m.content) out.push({ role: 'assistant', content: m.content })
  return out
}

// --- Claude (Anthropic) -----------------------------------------------------

function buildClaude(req: ChatRequest): BuiltRequest {
  const { config, parameters: p } = req
  const url = `${trimSlash(config.baseUrl)}/messages`

  const messages = req.messages.flatMap((m) =>
    m.role === 'assistant' && m.toolRounds?.length
      ? claudeToolMessages(m)
      : [
          {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: claudeContent(m),
          },
        ],
  )

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

  if (nativeToolsEnabled(req)) {
    body.tools = req.tools!.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
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

/** Expand an assistant message's tool rounds into Claude wire messages. */
function claudeToolMessages(m: Message): unknown[] {
  const out: unknown[] = []
  for (const round of m.toolRounds ?? []) {
    if (round.native) {
      const assistantBlocks: unknown[] = []
      if (round.content) assistantBlocks.push({ type: 'text', text: round.content })
      for (const tc of round.toolCalls)
        assistantBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.args,
        })
      out.push({ role: 'assistant', content: assistantBlocks })
      out.push({
        role: 'user',
        content: round.toolCalls.map((tc) => ({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: tc.result ?? toolErrorText(tc),
          ...(tc.status === 'error' ? { is_error: true } : {}),
        })),
      })
    } else {
      out.push({ role: 'assistant', content: reactActionText(round) })
      out.push({ role: 'user', content: reactObservationText(round) })
    }
  }
  if (m.content) out.push({ role: 'assistant', content: claudeContent(m) })
  return out
}

// --- Gemini -----------------------------------------------------------------

function buildGemini(req: ChatRequest): BuiltRequest {
  const { config, parameters: p } = req
  const method = p.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const url = `${trimSlash(config.baseUrl)}/models/${config.modelId}:${method}`

  const contents = req.messages.flatMap((m) =>
    m.role === 'assistant' && m.toolRounds?.length
      ? geminiToolContents(m)
      : [
          {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: geminiParts(m),
          },
        ],
  )

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
  if (nativeToolsEnabled(req)) {
    body.tools = [
      {
        functionDeclarations: req.tools!.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ]
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

/** Expand an assistant message's tool rounds into Gemini wire contents. */
function geminiToolContents(m: Message): unknown[] {
  const out: unknown[] = []
  for (const round of m.toolRounds ?? []) {
    if (round.native) {
      const modelParts: unknown[] = []
      if (round.content) modelParts.push({ text: round.content })
      for (const tc of round.toolCalls)
        modelParts.push({
          functionCall: { name: tc.name, args: tc.args },
          // Gemini requires its thoughtSignature echoed back on replay.
          ...(tc.signature ? { thoughtSignature: tc.signature } : {}),
        })
      out.push({ role: 'model', parts: modelParts })
      out.push({
        role: 'user',
        parts: round.toolCalls.map((tc) => ({
          functionResponse: {
            name: tc.name,
            response: { result: tc.result ?? toolErrorText(tc) },
          },
        })),
      })
    } else {
      out.push({ role: 'model', parts: [{ text: reactActionText(round) }] })
      out.push({ role: 'user', parts: [{ text: reactObservationText(round) }] })
    }
  }
  if (m.content) out.push({ role: 'model', parts: geminiParts(m) })
  return out
}

/** A document attachment carrying extracted text (vs. a native PDF/base64). */
function isTextDoc(a: Attachment): boolean {
  return a.kind === 'document' && typeof a.text === 'string'
}

// --- tool-round replay helpers ----------------------------------------------

function toolErrorText(tc: ToolCall): string {
  return tc.error ? `Error: ${tc.error}` : '(no result)'
}

/** Reconstruct the assistant's ReAct action turn (prose + fenced JSON action). */
function reactActionText(round: ToolRound): string {
  const actions = round.toolCalls
    .map(
      (tc) =>
        '```json\n' +
        JSON.stringify({ tool: tc.name, args: tc.args }) +
        '\n```',
    )
    .join('\n')
  return [round.content?.trim(), actions].filter(Boolean).join('\n\n')
}

function reactObservationText(round: ToolRound): string {
  return round.toolCalls
    .map((tc) => `OBSERVATION (${tc.name}): ${tc.result ?? toolErrorText(tc)}`)
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Provider response shapes (loosely typed; field values validated at use site)
// ---------------------------------------------------------------------------

interface OpenAIToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: unknown }
}
interface OpenAIDelta {
  role?: string
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  tool_calls?: OpenAIToolCallDelta[]
}
interface OpenAIResponse {
  choices?: Array<{
    delta?: OpenAIDelta
    message?: OpenAIDelta
    finish_reason?: string
  }>
}

interface ClaudeStreamEvent {
  type?: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
  }
  error?: { message?: string }
}
interface ClaudeResponse {
  content?: Array<{
    type?: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: unknown
  }>
}

interface GeminiPart {
  text?: unknown
  thought?: unknown
  thoughtSignature?: string
  functionCall?: { name?: string; args?: Record<string, unknown> }
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
}

// ---------------------------------------------------------------------------
// Streaming SSE event handlers per provider
// ---------------------------------------------------------------------------

interface EventHandler {
  handle: (json: unknown) => void
  finalize: () => { toolCalls: ParsedToolCall[] }
}

function pickEventHandler(
  type: ApiConfig['type'],
  cb: StreamCallbacks,
  splitter: ReturnType<typeof createThinkSplitter>,
): EventHandler {
  if (type === 'claude') return makeClaudeHandler(cb)
  if (type === 'gemini') return makeGeminiHandler(cb)
  return makeOpenAIHandler(cb, splitter)
}

function makeOpenAIHandler(
  cb: StreamCallbacks,
  splitter: ReturnType<typeof createThinkSplitter>,
): EventHandler {
  const acc = new Map<number, { id: string; name: string; args: string }>()
  return {
    handle: (raw: unknown) => {
      const json = raw as OpenAIResponse
      const choice = json?.choices?.[0]
      if (!choice) return
      const delta: OpenAIDelta = choice.delta ?? choice.message ?? {}
      const reasoning = delta.reasoning_content ?? delta.reasoning
      if (typeof reasoning === 'string' && reasoning) cb.onReasoning(reasoning)
      if (typeof delta.content === 'string' && delta.content) {
        splitter.push(delta.content)
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0
          const cur = acc.get(idx) ?? { id: '', name: '', args: '' }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.name = tc.function.name
          if (typeof tc.function?.arguments === 'string')
            cur.args += tc.function.arguments
          acc.set(idx, cur)
        }
      }
    },
    finalize: () => ({
      toolCalls: [...acc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({
          id: v.id || uid('tc_'),
          name: v.name,
          argsRaw: v.args || '{}',
        }))
        .filter((c) => c.name),
    }),
  }
}

function makeClaudeHandler(cb: StreamCallbacks): EventHandler {
  const blocks = new Map<
    number,
    { id: string; name: string; args: string; isTool: boolean }
  >()
  return {
    handle: (raw: unknown) => {
      const json = raw as ClaudeStreamEvent
      if (json?.type === 'content_block_start') {
        const blk = json.content_block
        if (blk?.type === 'tool_use') {
          blocks.set(json.index ?? 0, {
            id: blk.id ?? '',
            name: blk.name ?? '',
            args: '',
            isTool: true,
          })
        }
      } else if (json?.type === 'content_block_delta') {
        const d = json.delta
        if (d?.type === 'text_delta' && d.text) cb.onContent(d.text)
        else if (d?.type === 'thinking_delta' && d.thinking)
          cb.onReasoning(d.thinking)
        else if (
          d?.type === 'input_json_delta' &&
          typeof d.partial_json === 'string'
        ) {
          const blk = blocks.get(json.index ?? 0)
          if (blk) blk.args += d.partial_json
        }
      } else if (json?.type === 'error') {
        cb.onError(json.error?.message ?? 'Anthropic stream error')
      }
    },
    finalize: () => ({
      toolCalls: [...blocks.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, v]) => v.isTool && v.name)
        .map(([, v]) => ({
          id: v.id || uid('tc_'),
          name: v.name,
          argsRaw: v.args || '{}',
        })),
    }),
  }
}

function makeGeminiHandler(cb: StreamCallbacks): EventHandler {
  const calls: ParsedToolCall[] = []
  return {
    handle: (raw: unknown) => {
      const json = raw as GeminiResponse
      const parts = json?.candidates?.[0]?.content?.parts
      if (!Array.isArray(parts)) return
      for (const part of parts) {
        if (part?.functionCall?.name) {
          calls.push({
            id: uid('tc_'),
            name: part.functionCall.name,
            argsRaw: JSON.stringify(part.functionCall.args ?? {}),
            signature: part.thoughtSignature,
          })
        } else if (typeof part?.text === 'string') {
          if (part.thought) cb.onReasoning(part.text)
          else cb.onContent(part.text)
        }
      }
    },
    finalize: () => ({ toolCalls: calls }),
  }
}

// ---------------------------------------------------------------------------
// Non-streaming final-response parsers per provider
// ---------------------------------------------------------------------------

function parseFinal(
  type: ApiConfig['type'],
  json: ClaudeResponse & GeminiResponse & OpenAIResponse,
  cb: StreamCallbacks,
): ParsedToolCall[] | null {
  if (type === 'claude') {
    const blocks = json?.content
    const calls: ParsedToolCall[] = []
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b?.type === 'text' && b.text) cb.onContent(b.text)
        else if (b?.type === 'thinking' && b.thinking) cb.onReasoning(b.thinking)
        else if (b?.type === 'tool_use' && b.name)
          calls.push({
            id: b.id || uid('tc_'),
            name: b.name,
            argsRaw: JSON.stringify(b.input ?? {}),
          })
      }
    }
    return calls.length ? calls : null
  }
  if (type === 'gemini') {
    const parts = json?.candidates?.[0]?.content?.parts
    const calls: ParsedToolCall[] = []
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part?.functionCall?.name) {
          calls.push({
            id: uid('tc_'),
            name: part.functionCall.name,
            argsRaw: JSON.stringify(part.functionCall.args ?? {}),
            signature: part.thoughtSignature,
          })
        } else if (typeof part?.text === 'string') {
          if (part.thought) cb.onReasoning(part.text)
          else cb.onContent(part.text)
        }
      }
    }
    return calls.length ? calls : null
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
  const calls: ParsedToolCall[] = []
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.function?.name) {
        calls.push({
          id: tc.id || uid('tc_'),
          name: tc.function.name,
          argsRaw:
            typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments ?? {}),
        })
      }
    }
  }
  return calls.length ? calls : null
}

/** Collect the JSON payloads from `data:` SSE lines (skips keep-alives / [DONE]). */
function collectSseData(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    out.push(data)
  }
  return out
}

/**
 * Parse a non-streaming body that the server framed as SSE (`data:` lines)
 * despite stream:false. Routes payloads through the same per-provider stream
 * handlers used for real streaming, so both delta-shaped events and a single
 * full-response event are handled (the OpenAI handler reads `delta ?? message`).
 */
function parseSseFinal(
  type: ApiConfig['type'],
  text: string,
  cb: StreamCallbacks,
): ParsedToolCall[] | null {
  const splitter = createThinkSplitter(cb.onContent, cb.onReasoning)
  const handler = pickEventHandler(type, cb, splitter)
  for (const data of collectSseData(text)) {
    try {
      handler.handle(JSON.parse(data))
    } catch {
      // skip a malformed / non-JSON line rather than failing the whole body
    }
  }
  splitter.end()
  const { toolCalls } = handler.finalize()
  return toolCalls.length ? toolCalls : null
}
