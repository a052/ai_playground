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
  apiType: ApiType
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
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
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
  sessions?: ChatSession[]
}

/** Streaming callbacks emitted by the API client. */
export interface StreamCallbacks {
  onContent: (deltaText: string) => void
  onReasoning: (deltaText: string) => void
  onTransaction: (tx: HttpTransaction) => void
  onError: (message: string) => void
  onDone: () => void
}
