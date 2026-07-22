import type {
  ApiConfig,
  HttpTransaction,
  Message,
  ModelParameters,
  ParsedToolCall,
  SearchConfig,
  SearchSettings,
  ToolCall,
  ToolDef,
  ToolRound,
} from '@/types'
import { streamChat } from '@/lib/apiClient'
import { runWebSearch } from '@/lib/searchClient'
import { runFetchUrl } from '@/lib/urlFetcher'
import type { ToolContext } from '@/lib/toolContext'
import { useAppStore } from '@/store/useAppStore'
import { uid } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current, real-time, or factual information. Returns a ranked list of results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch and read the readable text of a web page by URL. Use it to read a specific search result in depth, or to read a URL the user provided.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The absolute URL to fetch.' },
      },
      required: ['url'],
    },
  },
]

const NATIVE_SEARCH_HINT =
  'You can use the web_search and fetch_url tools to access the internet. Use them whenever current information or a specific web page would help, then answer from the results and cite source URLs.'

function buildReactSystemPrompt(): string {
  return [
    'You can use tools to access the internet. Available tools:',
    '- web_search(query): search the web for information.',
    '- fetch_url(url): read the text content of a web page.',
    '',
    'To call a tool, reply with ONLY a single fenced code block and nothing else:',
    '```json',
    '{"tool": "web_search", "args": {"query": "your query"}}',
    '```',
    'Then stop. You will receive an "OBSERVATION:" with the result, after which you continue.',
    'When you have enough information, reply normally WITHOUT any json tool block to give your final answer, citing source URLs.',
  ].join('\n')
}

export interface AgenticOptions {
  sessionId: string
  assistantId: string
  config: ApiConfig
  parameters: ModelParameters
  /** Conversation up to and including the latest user message. */
  baseHistory: Message[]
  corsProxy: string
  signal: AbortSignal
  searchConfigs: SearchConfig[]
  searchSettings: SearchSettings
}

const store = () => useAppStore.getState()

/** Snapshot rounds with fresh object refs so the store/UI detect the change. */
function snapshot(rounds: ToolRound[]): ToolRound[] {
  return rounds.map((r) => ({ ...r, toolCalls: r.toolCalls.map((tc) => ({ ...tc })) }))
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

function syntheticAssistant(rounds: ToolRound[]): Message {
  return {
    id: 'agent_inflight',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolRounds: rounds,
  }
}

/** Clone parameters, applying tool-mode-specific adjustments. */
function prepareParameters(
  base: ModelParameters,
  config: ApiConfig,
  promptToolMode: boolean,
): ModelParameters {
  const p: ModelParameters = { ...base, enabled: { ...base.enabled } }
  // The agentic loop drives its own web_search/fetch_url tools; provider-native
  // search must not stack on top of it, so force it off for these model calls.
  p.enabled.nativeWebSearch = false
  // Claude thinking + native tools requires replaying signed thinking blocks
  // (which we don't capture); disable thinking during the search loop.
  if (config.type === 'claude' && !promptToolMode) {
    p.enabled.claudeThinking = false
  }
  const hint = promptToolMode ? buildReactSystemPrompt() : NATIVE_SEARCH_HINT
  p.systemPrompt = [base.systemPrompt?.trim(), hint].filter(Boolean).join('\n\n')
  return p
}

/** Extract a ReAct action from streamed text, returning the call + cleaned text. */
function parseReactAction(
  text: string,
): { call: ParsedToolCall; cleaned: string } | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i
  const fenced = fence.exec(text)
  let jsonStr: string | null = null
  let matched = ''
  if (fenced) {
    jsonStr = fenced[1].trim()
    matched = fenced[0]
  } else {
    const bare = /\{[\s\S]*?"tool"[\s\S]*?\}/.exec(text)
    if (bare) {
      jsonStr = bare[0]
      matched = bare[0]
    }
  }
  if (!jsonStr) return null
  try {
    const obj = JSON.parse(jsonStr)
    if (obj && typeof obj === 'object' && typeof obj.tool === 'string') {
      return {
        call: {
          id: uid('tc_'),
          name: obj.tool,
          argsRaw: JSON.stringify(obj.args ?? {}),
        },
        cleaned: text.replace(matched, '').trim(),
      }
    }
  } catch {
    // not a valid action block
  }
  return null
}

/**
 * Run a multi-round agentic completion: call the model with tools, execute any
 * web_search / fetch_url calls in the browser, feed results back, and loop until
 * the model produces a final answer (or the iteration cap is hit). Every tool
 * HTTP call is captured as an inspectable transaction on its ToolCall.
 */
export async function runAgenticCompletion(opts: AgenticOptions): Promise<void> {
  const {
    sessionId,
    assistantId,
    config,
    baseHistory,
    corsProxy,
    signal,
    searchConfigs,
    searchSettings,
  } = opts

  const toolCtx: ToolContext = { searchConfigs, searchSettings, corsProxy, signal }
  const rounds: ToolRound[] = []
  let promptToolMode = false
  let parameters = prepareParameters(opts.parameters, config, promptToolMode)
  const maxIters = Math.max(1, searchSettings.maxIterations || 6)

  const update = (patch: Partial<Message>) =>
    store().updateMessage(sessionId, assistantId, patch)

  for (let iter = 0; iter < maxIters; iter++) {
    if (signal.aborted) return

    const working = rounds.length
      ? [...baseHistory, syntheticAssistant(rounds)]
      : baseHistory

    let roundContent = ''
    let roundReasoning = ''
    let roundTx: HttpTransaction | undefined

    const res = await streamChat({
      config,
      parameters,
      messages: working,
      corsProxy,
      signal,
      tools: TOOL_DEFS,
      promptToolMode,
      callbacks: {
        onContent: (d) => {
          roundContent += d
          store().appendToMessage(sessionId, assistantId, { content: d })
        },
        onReasoning: (d) => {
          roundReasoning += d
          store().appendToMessage(sessionId, assistantId, { reasoning: d })
        },
        onTransaction: (tx) => {
          roundTx = tx
        },
        onError: (msg) => update({ error: msg }),
        onDone: () => {},
      },
    })

    // Native tools rejected on the first round → retry the turn in ReAct mode.
    if (
      res.finish === 'error' &&
      res.errorStatus === 400 &&
      !promptToolMode &&
      rounds.length === 0
    ) {
      promptToolMode = true
      parameters = prepareParameters(opts.parameters, config, promptToolMode)
      update({ content: '', reasoning: '', error: undefined, toolRounds: undefined })
      iter = -1
      continue
    }

    if (res.finish === 'aborted' || res.finish === 'error') return

    // Determine the tool calls for this round.
    let parsed: ParsedToolCall[] = []
    let cleanedContent = roundContent
    if (promptToolMode) {
      const action = parseReactAction(roundContent)
      if (action) {
        parsed = [action.call]
        cleanedContent = action.cleaned
      }
    } else if (res.finish === 'tool_calls' && res.toolCalls) {
      parsed = res.toolCalls
    }

    if (parsed.length === 0) {
      // Final answer already streamed into message.content.
      update({ transaction: roundTx })
      return
    }

    const round: ToolRound = {
      content: cleanedContent.trim() || undefined,
      reasoning: roundReasoning.trim() || undefined,
      native: !promptToolMode,
      transaction: roundTx,
      toolCalls: parsed.map((p) => ({
        id: p.id,
        name: p.name,
        args: safeParseArgs(p.argsRaw),
        argsRaw: p.argsRaw,
        signature: p.signature,
        status: 'running' as ToolCall['status'],
      })),
    }
    rounds.push(round)
    // Move draft content into the round and surface the tool cards.
    update({ content: '', reasoning: '', toolRounds: snapshot(rounds) })

    // Execute each tool call in order.
    for (const tc of round.toolCalls) {
      if (signal.aborted) {
        tc.status = 'error'
        tc.error = 'Aborted'
        update({ toolRounds: snapshot(rounds) })
        return
      }
      const exec =
        tc.name === 'fetch_url'
          ? await runFetchUrl(tc.args, toolCtx)
          : await runWebSearch(tc.args, toolCtx)
      tc.result = exec.result
      tc.resultData = exec.resultData
      tc.transaction = exec.transaction
      tc.error = exec.error
      tc.status = exec.error ? 'error' : 'done'
      update({ toolRounds: snapshot(rounds) })
    }
  }

  // Iteration cap reached: force one final answer with tools disabled.
  if (signal.aborted) return
  let finalTx: HttpTransaction | undefined
  await streamChat({
    config,
    parameters,
    messages: [...baseHistory, syntheticAssistant(rounds)],
    corsProxy,
    signal,
    callbacks: {
      onContent: (d) =>
        store().appendToMessage(sessionId, assistantId, { content: d }),
      onReasoning: (d) =>
        store().appendToMessage(sessionId, assistantId, { reasoning: d }),
      onTransaction: (tx) => {
        finalTx = tx
      },
      onError: (msg) => update({ error: msg }),
      onDone: () => {},
    },
  })
  update({ transaction: finalTx })
}
