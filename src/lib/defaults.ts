import type {
  ApiConfig,
  ApiType,
  ModelParameters,
  SearchConfig,
  SearchProvider,
  SearchSettings,
  Settings,
  ToggleableParam,
} from '@/types'
import { uid } from '@/lib/utils'

/** Only these three parameters are enabled by default. */
export const DEFAULT_ENABLED: Record<ToggleableParam, boolean> = {
  temperature: true,
  maxCompletionTokens: true,
  topP: true,
  topK: false,
  presencePenalty: false,
  frequencyPenalty: false,
  responseFormat: false,
  stopSequences: false,
  seed: false,
  reasoningEffort: false,
  geminiThinkingLevel: false,
  claudeThinking: false,
  n: false,
  logitBias: false,
}

export const DEFAULT_PARAMETERS: ModelParameters = {
  stream: true,
  enabled: { ...DEFAULT_ENABLED },
  systemPrompt: '',
  temperature: 0.7,
  maxCompletionTokens: 65536,
  topP: 0.95,
  topK: null,
  presencePenalty: 0,
  frequencyPenalty: 0,
  responseFormat: 'text',
  stopSequences: [],
  seed: null,
  reasoningEffort: 'medium',
  reasoningCustomEnabled: false,
  reasoningCustom: '',
  geminiThinkingLevel: 'medium',
  claudeEffort: 'high',
  n: 1,
  logitBias: '',
}

/**
 * Deep-merge an unknown/partial parameters blob (from localStorage or an
 * imported backup) onto the defaults so older saves missing newer fields
 * (`stream`, `enabled`, `maxCompletionTokens`) don't break the app.
 */
export function normalizeParameters(raw: unknown): ModelParameters {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PARAMETERS }
  const r = raw as Record<string, unknown>
  const enabled =
    typeof r.enabled === 'object' && r.enabled !== null
      ? { ...DEFAULT_ENABLED, ...(r.enabled as Record<string, boolean>) }
      : { ...DEFAULT_ENABLED }
  return {
    ...DEFAULT_PARAMETERS,
    ...(r as Partial<ModelParameters>),
    enabled,
  }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'en',
  corsProxy: '',
  activeConfigId: null,
}

/** Pre-baked templates the user can add with one click. */
export interface ApiTemplate {
  label: string
  type: ApiType
  baseUrl: string
  modelId: string
  apiKey?: string
}

export const API_TEMPLATES: ApiTemplate[] = [
  {
    label: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-5.5',
  },
  {
    label: 'Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-3.5-flash',
  },
  {
    label: 'Claude (Anthropic)',
    type: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-sonnet-4-6',
  },
  {
    label: 'Ollama (Local)',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'llama3.2',
  },
  {
    label: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-v4-flash',
  },
]

export function templateToConfig(t: ApiTemplate): ApiConfig {
  return {
    id: uid('api_'),
    name: t.label,
    type: t.type,
    baseUrl: t.baseUrl,
    modelId: t.modelId,
    apiKey: t.apiKey ?? '',
  }
}

export function emptyConfig(): ApiConfig {
  return {
    id: uid('api_'),
    name: '',
    type: 'openai',
    baseUrl: '',
    modelId: '',
    apiKey: '',
  }
}

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  enabled: false,
  activeConfigId: null,
  depth: 'snippets',
  topN: 3,
  maxResults: 5,
  maxIterations: 6,
  maxPageChars: 200000,
}

/** Deep-merge a stored/imported search-settings blob onto the defaults. */
export function normalizeSearchSettings(raw: unknown): SearchSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SEARCH_SETTINGS }
  const r = raw as Partial<SearchSettings>
  const merged: SearchSettings = { ...DEFAULT_SEARCH_SETTINGS, ...r }
  if (merged.depth !== 'snippets' && merged.depth !== 'fetch_top_n')
    merged.depth = DEFAULT_SEARCH_SETTINGS.depth
  merged.topN = Number.isFinite(merged.topN) ? merged.topN : DEFAULT_SEARCH_SETTINGS.topN
  merged.maxResults = Number.isFinite(merged.maxResults)
    ? merged.maxResults
    : DEFAULT_SEARCH_SETTINGS.maxResults
  merged.maxIterations = Number.isFinite(merged.maxIterations)
    ? merged.maxIterations
    : DEFAULT_SEARCH_SETTINGS.maxIterations
  merged.maxPageChars = Number.isFinite(merged.maxPageChars)
    ? merged.maxPageChars
    : DEFAULT_SEARCH_SETTINGS.maxPageChars
  return merged
}

/** Quick-add presets for the search-config editor. */
export interface SearchTemplate {
  label: string
  provider: SearchProvider
  baseUrl?: string
  /** Hint shown under the API-key field (e.g. where to get a key). */
  hint?: string
}

export const SEARCH_TEMPLATES: SearchTemplate[] = [
  { label: 'Tavily', provider: 'tavily' },
  { label: 'Brave', provider: 'brave' },
  { label: 'Serper', provider: 'serper' },
  { label: 'Exa', provider: 'exa' },
  { label: 'Custom', provider: 'custom' },
]

export function emptySearchConfig(): SearchConfig {
  return {
    id: uid('sc_'),
    name: '',
    provider: 'tavily',
    apiKey: '',
    baseUrl: '',
    extraParams: '',
  }
}
