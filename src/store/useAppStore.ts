import { create } from 'zustand'
import type {
  ApiConfig,
  BackupScope,
  ChatSession,
  Language,
  Message,
  ModelParameters,
  Settings,
  ThemeMode,
} from '@/types'
import {
  DEFAULT_PARAMETERS,
  DEFAULT_SETTINGS,
  normalizeParameters,
} from '@/lib/defaults'
import {
  clearLocalConfig,
  clearSessionStore,
  configStorage,
  loadSessions,
  paramsStorage,
  saveSessions,
  settingsStorage,
} from '@/lib/storage'
import { buildBackup, parseBackup } from '@/lib/backup'
import { uid } from '@/lib/utils'

// --- debounced session persistence ----------------------------------------
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionSave(sessions: ChatSession[]) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveSessions(sessions), 600)
}

/** Outcome of opening a session, used by the UI to decide which toast to show. */
export interface OpenSessionResult {
  status: 'none' | 'switched' | 'missing'
  modelName?: string
}

interface AppState {
  // data
  configs: ApiConfig[]
  parameters: ModelParameters
  settings: Settings
  sessions: ChatSession[]
  activeSessionId: string | null

  // runtime
  hydrated: boolean
  isGenerating: boolean
  abortController: AbortController | null

  // hydration / lifecycle
  hydrate: () => Promise<void>

  // configs
  addConfig: (config: ApiConfig) => void
  updateConfig: (id: string, patch: Partial<ApiConfig>) => void
  duplicateConfig: (id: string) => void
  removeConfig: (id: string) => void
  setActiveConfig: (id: string | null) => void

  // parameters
  setParameter: <K extends keyof ModelParameters>(
    key: K,
    value: ModelParameters[K],
  ) => void
  resetParameters: () => void

  // settings
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  setLanguage: (language: Language) => void
  setCorsProxy: (url: string) => void

  // sessions
  createSession: () => string
  ensureActiveSession: () => string
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  setActiveSession: (id: string) => void
  setSessionModel: (sessionId: string, configId: string) => void
  openSession: (id: string) => OpenSessionResult

  // messages
  addMessage: (sessionId: string, message: Message) => void
  updateMessage: (
    sessionId: string,
    messageId: string,
    patch: Partial<Message>,
  ) => void
  appendToMessage: (
    sessionId: string,
    messageId: string,
    delta: { content?: string; reasoning?: string },
  ) => void
  deleteMessage: (sessionId: string, messageId: string) => void

  // generation control
  setGenerating: (value: boolean) => void
  setAbortController: (controller: AbortController | null) => void
  stopGeneration: () => void

  // backup
  exportBackup: (scope: BackupScope) => void
  importBackup: (raw: string) => void
  clearAll: () => Promise<void>
}

function persistConfigs(configs: ApiConfig[]) {
  configStorage.save(configs)
}
function persistParams(params: ModelParameters) {
  paramsStorage.save(params)
}
function persistSettings(settings: Settings) {
  settingsStorage.save(settings)
}

/** Immutably patch a session in the sessions array and bump `updatedAt`. */
function patchSession(
  sessions: ChatSession[],
  id: string,
  fn: (s: ChatSession) => ChatSession,
): ChatSession[] {
  return sessions.map((s) => (s.id === id ? fn(s) : s))
}

export const useAppStore = create<AppState>((set, get) => ({
  configs: [],
  parameters: { ...DEFAULT_PARAMETERS },
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  activeSessionId: null,

  hydrated: false,
  isGenerating: false,
  abortController: null,

  hydrate: async () => {
    const configs = configStorage.load([])
    const parameters = normalizeParameters(
      paramsStorage.load({ ...DEFAULT_PARAMETERS }),
    )
    const settings = settingsStorage.load({ ...DEFAULT_SETTINGS })
    const sessions = await loadSessions()
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)

    // Validate the active config still exists.
    if (
      settings.activeConfigId &&
      !configs.some((c) => c.id === settings.activeConfigId)
    ) {
      settings.activeConfigId = configs[0]?.id ?? null
    } else if (!settings.activeConfigId && configs.length > 0) {
      settings.activeConfigId = configs[0].id
    }

    set({
      configs,
      parameters,
      settings,
      sessions,
      activeSessionId: sessions[0]?.id ?? null,
      hydrated: true,
    })
  },

  // --- configs -------------------------------------------------------------
  addConfig: (config) => {
    const configs = [...get().configs, config]
    const settings = { ...get().settings }
    if (!settings.activeConfigId) settings.activeConfigId = config.id
    persistConfigs(configs)
    persistSettings(settings)
    set({ configs, settings })
  },
  updateConfig: (id, patch) => {
    const configs = get().configs.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    )
    persistConfigs(configs)
    set({ configs })
  },
  duplicateConfig: (id) => {
    const src = get().configs.find((c) => c.id === id)
    if (!src) return
    const copy: ApiConfig = { ...src, id: uid('api_'), name: `${src.name}-copy` }
    get().addConfig(copy)
    get().setActiveConfig(copy.id)
  },
  removeConfig: (id) => {
    const configs = get().configs.filter((c) => c.id !== id)
    const settings = { ...get().settings }
    if (settings.activeConfigId === id) {
      settings.activeConfigId = configs[0]?.id ?? null
    }
    persistConfigs(configs)
    persistSettings(settings)
    set({ configs, settings })
  },
  setActiveConfig: (id) => {
    const settings = { ...get().settings, activeConfigId: id }
    persistSettings(settings)
    set({ settings })
  },

  // --- parameters ----------------------------------------------------------
  setParameter: (key, value) => {
    const parameters = { ...get().parameters, [key]: value }
    persistParams(parameters)
    set({ parameters })
  },
  resetParameters: () => {
    const parameters = { ...DEFAULT_PARAMETERS }
    persistParams(parameters)
    set({ parameters })
  },

  // --- settings ------------------------------------------------------------
  setTheme: (theme) => {
    const settings = { ...get().settings, theme }
    persistSettings(settings)
    set({ settings })
  },
  toggleTheme: () => {
    const theme: ThemeMode =
      get().settings.theme === 'dark' ? 'light' : 'dark'
    get().setTheme(theme)
  },
  setLanguage: (language) => {
    const settings = { ...get().settings, language }
    persistSettings(settings)
    set({ settings })
  },
  setCorsProxy: (url) => {
    const settings = { ...get().settings, corsProxy: url }
    persistSettings(settings)
    set({ settings })
  },

  // --- sessions ------------------------------------------------------------
  createSession: () => {
    const now = Date.now()
    const session: ChatSession = {
      id: uid('chat_'),
      title: '',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    const sessions = [session, ...get().sessions]
    scheduleSessionSave(sessions)
    set({ sessions, activeSessionId: session.id })
    return session.id
  },
  ensureActiveSession: () => {
    const { activeSessionId, sessions } = get()
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) {
      return activeSessionId
    }
    return get().createSession()
  },
  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id)
    let activeSessionId = get().activeSessionId
    if (activeSessionId === id) activeSessionId = sessions[0]?.id ?? null
    scheduleSessionSave(sessions)
    set({ sessions, activeSessionId })
  },
  renameSession: (id, title) => {
    const sessions = patchSession(get().sessions, id, (s) => ({
      ...s,
      title,
      updatedAt: Date.now(),
    }))
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  setActiveSession: (id) => set({ activeSessionId: id }),
  setSessionModel: (sessionId, configId) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => ({
      ...s,
      lastUsedConfigId: configId,
    }))
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  openSession: (id) => {
    const { sessions, settings, configs } = get()
    const session = sessions.find((s) => s.id === id)
    get().setActiveSession(id)
    const recorded = session?.lastUsedConfigId
    if (!recorded || recorded === settings.activeConfigId) return { status: 'none' }
    const target = configs.find((c) => c.id === recorded)
    if (target) {
      get().setActiveConfig(recorded)
      return { status: 'switched', modelName: target.name }
    }
    const current = configs.find((c) => c.id === settings.activeConfigId)
    return { status: 'missing', modelName: current?.name }
  },

  // --- messages ------------------------------------------------------------
  addMessage: (sessionId, message) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => {
      // Derive a title from the first user message.
      let title = s.title
      if (!title && message.role === 'user') {
        title = message.content.slice(0, 48) || 'New conversation'
      }
      return {
        ...s,
        title,
        messages: [...s.messages, message],
        updatedAt: Date.now(),
      }
    })
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  updateMessage: (sessionId, messageId, patch) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m,
      ),
      updatedAt: Date.now(),
    }))
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  appendToMessage: (sessionId, messageId, delta) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: m.content + (delta.content ?? ''),
              reasoning: (m.reasoning ?? '') + (delta.reasoning ?? ''),
            }
          : m,
      ),
      updatedAt: Date.now(),
    }))
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  deleteMessage: (sessionId, messageId) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => ({
      ...s,
      messages: s.messages.filter((m) => m.id !== messageId),
      updatedAt: Date.now(),
    }))
    scheduleSessionSave(sessions)
    set({ sessions })
  },

  // --- generation ----------------------------------------------------------
  setGenerating: (value) => set({ isGenerating: value }),
  setAbortController: (controller) => set({ abortController: controller }),
  stopGeneration: () => {
    const { abortController } = get()
    abortController?.abort()
    set({ isGenerating: false, abortController: null })
  },

  // --- backup --------------------------------------------------------------
  exportBackup: (scope) => {
    const { configs, parameters, settings, sessions } = get()
    const backup = buildBackup({ configs, parameters, settings, sessions }, scope)
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-playground-${scope}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  },
  importBackup: (raw) => {
    const backup = parseBackup(raw)
    const patch: Partial<AppState> = {}

    // Configuration slice (configs + parameters + settings) replaces in place.
    if (backup.configs) {
      const configs = backup.configs
      persistConfigs(configs)
      patch.configs = configs

      const settings = { ...(backup.settings ?? get().settings) }
      if (
        settings.activeConfigId &&
        !configs.some((c) => c.id === settings.activeConfigId)
      ) {
        settings.activeConfigId = configs[0]?.id ?? null
      } else if (!settings.activeConfigId && configs.length > 0) {
        settings.activeConfigId = configs[0].id
      }
      persistSettings(settings)
      patch.settings = settings

      if (backup.parameters) {
        persistParams(backup.parameters)
        patch.parameters = backup.parameters
      }
    }

    // Chats slice replaces sessions only.
    if (backup.sessions) {
      const sessions = backup.sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
      void saveSessions(sessions)
      patch.sessions = sessions
      patch.activeSessionId = sessions[0]?.id ?? null
    }

    set(patch)
  },
  clearAll: async () => {
    clearLocalConfig()
    await clearSessionStore()
    set({
      configs: [],
      parameters: { ...DEFAULT_PARAMETERS },
      settings: { ...DEFAULT_SETTINGS },
      sessions: [],
      activeSessionId: null,
    })
  },
}))

// --- convenience selectors --------------------------------------------------
export function useActiveSession() {
  return useAppStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  )
}

export function useActiveConfig() {
  return useAppStore((s) =>
    s.configs.find((c) => c.id === s.settings.activeConfigId),
  )
}
