import localforage from 'localforage'
import type {
  ApiConfig,
  ChatSession,
  ModelParameters,
  PromptTemplate,
  SearchConfig,
  SearchSettings,
  Settings,
} from '@/types'

// ---------------------------------------------------------------------------
// IndexedDB (via localforage) — heavy data: chat sessions incl. base64 media.
// ---------------------------------------------------------------------------

const sessionStore = localforage.createInstance({
  name: 'ai-playground',
  storeName: 'sessions',
  description: 'Chat sessions and inline media',
})

const SESSIONS_KEY = 'sessions'

export async function loadSessions(): Promise<ChatSession[]> {
  try {
    const data = await sessionStore.getItem<ChatSession[]>(SESSIONS_KEY)
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.warn('[storage] failed to load sessions', err)
    return []
  }
}

export async function saveSessions(sessions: ChatSession[]): Promise<void> {
  try {
    await sessionStore.setItem(SESSIONS_KEY, sessions)
  } catch (err) {
    console.warn('[storage] failed to persist sessions', err)
  }
}

export async function clearSessionStore(): Promise<void> {
  try {
    await sessionStore.clear()
  } catch (err) {
    console.warn('[storage] failed to clear sessions', err)
  }
}

// ---------------------------------------------------------------------------
// localStorage — lightweight config: API list, parameters, settings.
// ---------------------------------------------------------------------------

const LS_CONFIGS = 'ai-playground:configs'
const LS_PARAMS = 'ai-playground:parameters'
const LS_SETTINGS = 'ai-playground:settings'
const LS_PROMPT_TEMPLATES = 'ai-playground:promptTemplates'
const LS_REASONING_TEMPLATES = 'ai-playground:reasoningTemplates'
const LS_SEARCH_CONFIGS = 'ai-playground:searchConfigs'
const LS_SEARCH_SETTINGS = 'ai-playground:searchSettings'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn(`[storage] failed to write ${key}`, err)
  }
}

export const configStorage = {
  load: (fallback: ApiConfig[]) => readJSON<ApiConfig[]>(LS_CONFIGS, fallback),
  save: (configs: ApiConfig[]) => writeJSON(LS_CONFIGS, configs),
}

export const paramsStorage = {
  load: (fallback: ModelParameters) =>
    readJSON<ModelParameters>(LS_PARAMS, fallback),
  save: (params: ModelParameters) => writeJSON(LS_PARAMS, params),
}

export const settingsStorage = {
  load: (fallback: Settings) => readJSON<Settings>(LS_SETTINGS, fallback),
  save: (settings: Settings) => writeJSON(LS_SETTINGS, settings),
}

export const promptTemplatesStorage = {
  load: (fallback: PromptTemplate[]) =>
    readJSON<PromptTemplate[]>(LS_PROMPT_TEMPLATES, fallback),
  save: (templates: PromptTemplate[]) =>
    writeJSON(LS_PROMPT_TEMPLATES, templates),
}

export const reasoningTemplatesStorage = {
  load: (fallback: PromptTemplate[]) =>
    readJSON<PromptTemplate[]>(LS_REASONING_TEMPLATES, fallback),
  save: (templates: PromptTemplate[]) =>
    writeJSON(LS_REASONING_TEMPLATES, templates),
}

export const searchConfigsStorage = {
  load: (fallback: SearchConfig[]) =>
    readJSON<SearchConfig[]>(LS_SEARCH_CONFIGS, fallback),
  save: (configs: SearchConfig[]) => writeJSON(LS_SEARCH_CONFIGS, configs),
}

export const searchSettingsStorage = {
  load: (fallback: SearchSettings) =>
    readJSON<SearchSettings>(LS_SEARCH_SETTINGS, fallback),
  save: (settings: SearchSettings) => writeJSON(LS_SEARCH_SETTINGS, settings),
}

export function clearLocalConfig(): void {
  localStorage.removeItem(LS_CONFIGS)
  localStorage.removeItem(LS_PARAMS)
  localStorage.removeItem(LS_SETTINGS)
  localStorage.removeItem(LS_PROMPT_TEMPLATES)
  localStorage.removeItem(LS_REASONING_TEMPLATES)
  localStorage.removeItem(LS_SEARCH_CONFIGS)
  localStorage.removeItem(LS_SEARCH_SETTINGS)
}
