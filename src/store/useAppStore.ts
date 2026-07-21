import { create } from 'zustand'
import type {
  ApiConfig,
  BackupScope,
  ChatSession,
  Language,
  Message,
  ModelParameters,
  PromptTemplate,
  SearchConfig,
  SearchSettings,
  Settings,
  ThemeMode,
} from '@/types'
import {
  DEFAULT_PARAMETERS,
  DEFAULT_SEARCH_SETTINGS,
  DEFAULT_SETTINGS,
  normalizeParameters,
  normalizeSearchSettings,
} from '@/lib/defaults'
import {
  clearLocalConfig,
  clearSessionStore,
  configStorage,
  loadSessions,
  paramsStorage,
  promptTemplatesStorage,
  reasoningTemplatesStorage,
  saveSessions,
  searchConfigsStorage,
  searchSettingsStorage,
  settingsStorage,
} from '@/lib/storage'
import { buildBackup, parseBackup } from '@/lib/backup'
import { migrateLinear, subtreeLeaf } from '@/lib/messageTree'
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
  promptTemplates: PromptTemplate[]
  reasoningTemplates: PromptTemplate[]
  searchConfigs: SearchConfig[]
  searchSettings: SearchSettings
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

  // search configs & settings
  addSearchConfig: (config: SearchConfig) => void
  updateSearchConfig: (id: string, patch: Partial<SearchConfig>) => void
  removeSearchConfig: (id: string) => void
  setActiveSearchConfig: (id: string | null) => void
  setSearchSettings: (patch: Partial<SearchSettings>) => void
  toggleWebSearch: () => void

  // parameters
  setParameter: <K extends keyof ModelParameters>(
    key: K,
    value: ModelParameters[K],
  ) => void
  resetParameters: () => void

  // prompt templates (system-prompt library)
  addPromptTemplate: (title: string, content: string) => void
  updatePromptTemplate: (id: string, title: string, content: string) => void
  removePromptTemplate: (id: string) => void

  // reasoning custom-parameter templates
  addReasoningTemplate: (title: string, content: string) => void
  updateReasoningTemplate: (id: string, title: string, content: string) => void
  removeReasoningTemplate: (id: string) => void

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
  /** Switch the visible branch to the one whose tip descends from `messageId`. */
  switchBranch: (sessionId: string, messageId: string) => void

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
function persistPromptTemplates(templates: PromptTemplate[]) {
  promptTemplatesStorage.save(templates)
}
function persistReasoningTemplates(templates: PromptTemplate[]) {
  reasoningTemplatesStorage.save(templates)
}
function persistSearchConfigs(configs: SearchConfig[]) {
  searchConfigsStorage.save(configs)
}
function persistSearchSettings(settings: SearchSettings) {
  searchSettingsStorage.save(settings)
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
  promptTemplates: [],
  reasoningTemplates: [],
  searchConfigs: [],
  searchSettings: { ...DEFAULT_SEARCH_SETTINGS },
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
    const promptTemplates = promptTemplatesStorage.load([])
    const reasoningTemplates = reasoningTemplatesStorage.load([])
    const searchConfigs = searchConfigsStorage.load([])
    const searchSettings = normalizeSearchSettings(
      searchSettingsStorage.load({ ...DEFAULT_SEARCH_SETTINGS }),
    )
    const sessions = (await loadSessions()).map(migrateLinear)
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

    // Validate the active search config still exists.
    if (
      searchSettings.activeConfigId &&
      !searchConfigs.some((c) => c.id === searchSettings.activeConfigId)
    ) {
      searchSettings.activeConfigId = searchConfigs[0]?.id ?? null
    } else if (!searchSettings.activeConfigId && searchConfigs.length > 0) {
      searchSettings.activeConfigId = searchConfigs[0].id
    }

    set({
      configs,
      parameters,
      settings,
      promptTemplates,
      reasoningTemplates,
      searchConfigs,
      searchSettings,
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

  // --- search configs & settings -------------------------------------------
  addSearchConfig: (config) => {
    const searchConfigs = [...get().searchConfigs, config]
    const searchSettings = { ...get().searchSettings }
    if (!searchSettings.activeConfigId) searchSettings.activeConfigId = config.id
    persistSearchConfigs(searchConfigs)
    persistSearchSettings(searchSettings)
    set({ searchConfigs, searchSettings })
  },
  updateSearchConfig: (id, patch) => {
    const searchConfigs = get().searchConfigs.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    )
    persistSearchConfigs(searchConfigs)
    set({ searchConfigs })
  },
  removeSearchConfig: (id) => {
    const searchConfigs = get().searchConfigs.filter((c) => c.id !== id)
    const searchSettings = { ...get().searchSettings }
    if (searchSettings.activeConfigId === id) {
      searchSettings.activeConfigId = searchConfigs[0]?.id ?? null
    }
    persistSearchConfigs(searchConfigs)
    persistSearchSettings(searchSettings)
    set({ searchConfigs, searchSettings })
  },
  setActiveSearchConfig: (id) => {
    const searchSettings = { ...get().searchSettings, activeConfigId: id }
    persistSearchSettings(searchSettings)
    set({ searchSettings })
  },
  setSearchSettings: (patch) => {
    const searchSettings = { ...get().searchSettings, ...patch }
    persistSearchSettings(searchSettings)
    set({ searchSettings })
  },
  toggleWebSearch: () => {
    const searchSettings = {
      ...get().searchSettings,
      enabled: !get().searchSettings.enabled,
    }
    persistSearchSettings(searchSettings)
    set({ searchSettings })
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

  // --- prompt templates ----------------------------------------------------
  addPromptTemplate: (title, content) => {
    const now = Date.now()
    const template: PromptTemplate = {
      id: uid('tpl_'),
      title,
      content,
      createdAt: now,
      updatedAt: now,
    }
    const promptTemplates = [...get().promptTemplates, template]
    persistPromptTemplates(promptTemplates)
    set({ promptTemplates })
  },
  updatePromptTemplate: (id, title, content) => {
    const promptTemplates = get().promptTemplates.map((t) =>
      t.id === id ? { ...t, title, content, updatedAt: Date.now() } : t,
    )
    persistPromptTemplates(promptTemplates)
    set({ promptTemplates })
  },
  removePromptTemplate: (id) => {
    const promptTemplates = get().promptTemplates.filter((t) => t.id !== id)
    persistPromptTemplates(promptTemplates)
    set({ promptTemplates })
  },

  // --- reasoning custom-parameter templates --------------------------------
  addReasoningTemplate: (title, content) => {
    const now = Date.now()
    const template: PromptTemplate = {
      id: uid('tpl_'),
      title,
      content,
      createdAt: now,
      updatedAt: now,
    }
    const reasoningTemplates = [...get().reasoningTemplates, template]
    persistReasoningTemplates(reasoningTemplates)
    set({ reasoningTemplates })
  },
  updateReasoningTemplate: (id, title, content) => {
    const reasoningTemplates = get().reasoningTemplates.map((t) =>
      t.id === id ? { ...t, title, content, updatedAt: Date.now() } : t,
    )
    persistReasoningTemplates(reasoningTemplates)
    set({ reasoningTemplates })
  },
  removeReasoningTemplate: (id) => {
    const reasoningTemplates = get().reasoningTemplates.filter(
      (t) => t.id !== id,
    )
    persistReasoningTemplates(reasoningTemplates)
    set({ reasoningTemplates })
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
      currentLeafId: null,
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
      // Fork point: explicit parentId if provided, else the current leaf.
      const parentId =
        message.parentId !== undefined ? message.parentId : s.currentLeafId ?? null
      const node: Message = { ...message, parentId }
      // Derive a title from the first user message.
      let title = s.title
      if (!title && node.role === 'user') {
        title = node.content.slice(0, 48) || 'New conversation'
      }
      return {
        ...s,
        title,
        messages: [...s.messages, node],
        currentLeafId: node.id,
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
    const sessions = patchSession(get().sessions, sessionId, (s) => {
      // Prune the whole subtree rooted at messageId.
      const doomed = new Set<string>([messageId])
      let grew = true
      while (grew) {
        grew = false
        for (const m of s.messages) {
          if (m.parentId && doomed.has(m.parentId) && !doomed.has(m.id)) {
            doomed.add(m.id)
            grew = true
          }
        }
      }
      const target = s.messages.find((m) => m.id === messageId)
      const messages = s.messages.filter((m) => !doomed.has(m.id))
      let currentLeafId = s.currentLeafId
      if (currentLeafId && doomed.has(currentLeafId)) {
        currentLeafId =
          (target?.parentId && messages.some((m) => m.id === target.parentId)
            ? target.parentId
            : messages[messages.length - 1]?.id) ?? null
      }
      return { ...s, messages, currentLeafId, updatedAt: Date.now() }
    })
    scheduleSessionSave(sessions)
    set({ sessions })
  },
  switchBranch: (sessionId, messageId) => {
    const sessions = patchSession(get().sessions, sessionId, (s) => ({
      ...s,
      currentLeafId: subtreeLeaf(s.messages, messageId, s.currentLeafId),
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
    const {
      configs,
      parameters,
      settings,
      promptTemplates,
      reasoningTemplates,
      searchConfigs,
      searchSettings,
      sessions,
    } = get()
    const backup = buildBackup(
      {
        configs,
        parameters,
        settings,
        promptTemplates,
        reasoningTemplates,
        searchConfigs,
        searchSettings,
        sessions,
      },
      scope,
    )
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

    if (backup.promptTemplates) {
      persistPromptTemplates(backup.promptTemplates)
      patch.promptTemplates = backup.promptTemplates
    }
    if (backup.reasoningTemplates) {
      persistReasoningTemplates(backup.reasoningTemplates)
      patch.reasoningTemplates = backup.reasoningTemplates
    }
    if (backup.searchConfigs) {
      const searchConfigs = backup.searchConfigs
      persistSearchConfigs(searchConfigs)
      patch.searchConfigs = searchConfigs

      const searchSettings = { ...(backup.searchSettings ?? get().searchSettings) }
      if (
        searchSettings.activeConfigId &&
        !searchConfigs.some((c) => c.id === searchSettings.activeConfigId)
      ) {
        searchSettings.activeConfigId = searchConfigs[0]?.id ?? null
      } else if (!searchSettings.activeConfigId && searchConfigs.length > 0) {
        searchSettings.activeConfigId = searchConfigs[0].id
      }
      persistSearchSettings(searchSettings)
      patch.searchSettings = searchSettings
    } else if (backup.searchSettings) {
      persistSearchSettings(backup.searchSettings)
      patch.searchSettings = backup.searchSettings
    }

    // Chats slice replaces sessions only.
    if (backup.sessions) {
      const sessions = backup.sessions
        .map(migrateLinear)
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
      promptTemplates: [],
      reasoningTemplates: [],
      searchConfigs: [],
      searchSettings: { ...DEFAULT_SEARCH_SETTINGS },
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
