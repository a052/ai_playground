import type {
  ApiConfig,
  ApiType,
  ModelParameters,
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
    label: 'Ollama (Local)',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'llama3.2',
    apiKey: 'ollama',
  },
  {
    label: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
  },
  {
    label: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
  },
  {
    label: 'Claude (Anthropic)',
    type: 'claude',
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-sonnet-4-6',
  },
  {
    label: 'Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-2.0-flash',
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
