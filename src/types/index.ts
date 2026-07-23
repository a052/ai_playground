// ---------------------------------------------------------------------------
// Core domain types for the AI Playground
// ---------------------------------------------------------------------------

/** Supported upstream API protocols. */
export type ApiType = 'openai' | 'gemini' | 'claude'

/** A user-configured API endpoint + model. */
export interface ApiConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  type: ApiType
}

/** Roles for chat messages. */
export type MessageRole = 'system' | 'user' | 'assistant'

/** Multi-modal attachment stored as a base64 data URL. */
export type AttachmentKind = 'image' | 'audio' | 'video' | 'document'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  mimeType: string
  /** `data:<mime>;base64,...` (media + native PDF). Empty for text/code docs. */
  dataUrl: string
  size: number
  /** Extracted text for text/code documents (PDFs are sent natively via dataUrl). */
  text?: string
}

/** Captured HTTP transaction for the inspector / cURL generator. */
export interface HttpTransaction {
  /** Provider type, or a tool-execution kind for search/fetch calls. */
  apiType: ApiType | 'search' | 'fetch'
  requestMethod: string
  requestUrl: string
  /** The URL actually used (may include CORS proxy prefix). */
  effectiveUrl: string
  requestHeaders: Record<string, string>
  /** Pretty-printed JSON request body. */
  requestBody: string
  responseStatus?: number
  responseStatusText?: string
  responseHeaders?: Record<string, string>
  /** Final accumulated response body (raw SSE or JSON). */
  responseBody?: string
  usedProxy: boolean
  /** Epoch ms when the request was initiated. */
  startedAt?: number
  durationMs?: number
  error?: string
}

export interface Message {
  id: string
  /** Parent node in the conversation tree; null/absent for the root message. */
  parentId?: string | null
  role: MessageRole
  content: string
  /** Captured reasoning / thinking trace, if any. */
  reasoning?: string
  attachments?: Attachment[]
  timestamp: number
  /** Model display name that produced an assistant message. */
  model?: string
  /** HTTP transaction metadata (assistant messages). */
  transaction?: HttpTransaction
  /** True while a response is actively streaming. */
  isStreaming?: boolean
  /** Error string if the request failed. */
  error?: string
  /** Agentic tool-calling rounds preceding the final answer (assistant only). */
  toolRounds?: ToolRound[]
}

// ---------------------------------------------------------------------------
// Tool calling & web search
// ---------------------------------------------------------------------------

/** Built-in tools the model can call when web search is enabled. */
export type ToolName = 'web_search' | 'fetch_url'
export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error'

/** A single web-search hit. */
export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Full page text, present when search depth = fetch top-N. */
  content?: string
  publishedAt?: string
}

/** The result of reading one URL. */
export interface FetchedPage {
  url: string
  title?: string
  text: string
  /** Which path produced the text: 'jina' | 'direct' | 'proxy'. */
  via: string
}

/** One model→tool request and its executed result, within an agentic round. */
export interface ToolCall {
  /** Provider-native id (OpenAI tool_calls[].id / Claude tool_use.id); Gemini
   *  has none so we synthesize one and do not send it back. */
  id: string
  name: ToolName | string
  args: Record<string, unknown>
  /** Raw streamed arguments JSON (fragments concatenated) for the inspector. */
  argsRaw?: string
  /** Gemini's `thoughtSignature` for this call — must be echoed back on replay. */
  signature?: string
  status: ToolCallStatus
  /** Stringified result fed back to the model. */
  result?: string
  /** Structured result for rich rendering. */
  resultData?: SearchResult[] | FetchedPage
  error?: string
  /** HTTP transaction of EXECUTING this tool (search API / Jina / proxy). */
  transaction?: HttpTransaction
}

/** One agentic round: the model call that requested tools, plus its calls. */
export interface ToolRound {
  /** Assistant text emitted alongside the tool calls in this round. */
  content?: string
  reasoning?: string
  toolCalls: ToolCall[]
  /** HTTP transaction of the MODEL call that produced this round. */
  transaction?: HttpTransaction
  /** True for native function calling; false for the ReAct prompt fallback
   *  (changes how the builders serialize this round on replay). */
  native: boolean
}

/** A finalized tool call parsed from a provider response. */
export interface ParsedToolCall {
  id: string
  name: string
  argsRaw: string
  /** Gemini's `thoughtSignature`, captured from the functionCall part. */
  signature?: string
}

/** Provider-neutral tool definition; builders translate to native shapes. */
export interface ToolDef {
  name: string
  description: string
  /** JSON-schema parameters. */
  parameters: Record<string, unknown>
}

export type StreamFinish = 'stop' | 'tool_calls' | 'error' | 'aborted'

/** Outcome of one model round, returned by `streamChat`. */
export interface StreamResult {
  finish: StreamFinish
  toolCalls?: ParsedToolCall[]
  /** HTTP status when finish = 'error' (used to detect native-tools rejection). */
  errorStatus?: number
}

/** Supported web-search providers (plus a generic 'custom'). */
export type SearchProvider = 'tavily' | 'brave' | 'serper' | 'exa' | 'custom'

/** A user-configured web-search API. */
export interface SearchConfig {
  id: string
  name: string
  provider: SearchProvider
  apiKey: string
  /** Optional endpoint override (required for 'custom'). */
  baseUrl?: string
  /** Raw JSON merged into the request (e.g. country, freshness, custom params). */
  extraParams?: string
}

export type SearchDepth = 'snippets' | 'fetch_top_n'

/** Web-search behavior settings (persisted). */
export interface SearchSettings {
  /** The composer "+" menu Web Search toggle. */
  enabled: boolean
  activeConfigId: string | null
  /** snippets only, or auto-fetch the top-N result pages. */
  depth: SearchDepth
  topN: number
  maxResults: number
  /** Agentic loop guard. */
  maxIterations: number
  /** Max characters of fetched page text fed back to the model. */
  maxPageChars: number
}

export interface ChatSession {
  id: string
  title: string
  /** Full node pool for the conversation tree (all branches). Order is not
   *  authoritative — `parentId` links define structure. */
  messages: Message[]
  /** Id of the tip message of the currently-selected branch. When absent, the
   *  last array element is treated as the leaf (covers legacy/migrated data). */
  currentLeafId?: string | null
  createdAt: number
  updatedAt: number
  /** Config id of the model last used to generate in this chat. */
  lastUsedConfigId?: string
}

// ---------------------------------------------------------------------------
// Tunable model parameters
// ---------------------------------------------------------------------------

export type ResponseFormat = 'text' | 'json_object'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Parameters that carry an enable checkbox (sent only when enabled). */
export type ToggleableParam =
  | 'temperature'
  | 'maxCompletionTokens'
  | 'topP'
  | 'topK'
  | 'presencePenalty'
  | 'frequencyPenalty'
  | 'responseFormat'
  | 'stopSequences'
  | 'seed'
  | 'reasoningEffort'
  | 'geminiThinkingLevel'
  | 'claudeThinking'
  | 'n'
  | 'logitBias'
  | 'nativeWebSearch'

export interface ModelParameters {
  /** Stream the response (SSE) vs. a single non-streaming completion. */
  stream: boolean
  /** Per-parameter enable flags; only enabled params are sent. */
  enabled: Record<ToggleableParam, boolean>
  /** Always-active; sent whenever non-empty. */
  systemPrompt: string
  temperature: number
  maxCompletionTokens: number
  topP: number
  topK: number | null
  presencePenalty: number
  frequencyPenalty: number
  responseFormat: ResponseFormat
  stopSequences: string[]
  seed: number | null
  reasoningEffort: ReasoningEffort
  /** When set, send `reasoningCustom` instead of the `reasoningEffort` enum (OpenAI-compatible). */
  reasoningCustomEnabled: boolean
  /** Raw JSON fragment merged into the OpenAI-compatible request body when custom reasoning is on. */
  reasoningCustom: string
  geminiThinkingLevel: GeminiThinkingLevel
  /** Claude adaptive-thinking effort level (output_config.effort). */
  claudeEffort: ClaudeEffort
  n: number
  /** Raw JSON text for logit_bias. */
  logitBias: string
  /** Raw JSON fragment of custom parameters merged into the request body (all providers); sent when non-empty. */
  customParams: string
}

// ---------------------------------------------------------------------------
// App-wide settings & persistence
// ---------------------------------------------------------------------------

export type ThemeMode = 'dark' | 'light'
export type Language = 'en' | 'zh'

export interface Settings {
  theme: ThemeMode
  language: Language
  corsProxy: string
  activeConfigId: string | null
}

/** A named, reusable snippet — used for both system prompts and custom
 *  reasoning JSON fragments. The two libraries are stored separately but
 *  share this shape. */
export interface PromptTemplate {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

/** Which slices a backup file carries. */
export type BackupScope = 'all' | 'configs' | 'chats'

/** Shape of the exported / imported backup file. Sections are optional so a
 *  partial export (configs-only or chats-only) can be round-tripped. */
export interface BackupFile {
  version: number
  exportedAt: number
  scope: BackupScope
  configs?: ApiConfig[]
  parameters?: ModelParameters
  settings?: Settings
  promptTemplates?: PromptTemplate[]
  reasoningTemplates?: PromptTemplate[]
  searchConfigs?: SearchConfig[]
  searchSettings?: SearchSettings
  sessions?: ChatSession[]
}

/** Streaming callbacks emitted by the API client. */
export interface StreamCallbacks {
  onContent: (deltaText: string) => void
  onReasoning: (deltaText: string) => void
  onTransaction: (tx: HttpTransaction) => void
  onError: (message: string) => void
  /** Emitted once when the model finishes a round requesting tool calls. */
  onToolCalls?: (calls: ParsedToolCall[]) => void
  onDone: () => void
}
