import type {
  ApiConfig,
  BackupFile,
  BackupScope,
  ChatSession,
  ModelParameters,
  Settings,
} from '@/types'
import {
  DEFAULT_SETTINGS,
  normalizeParameters,
} from '@/lib/defaults'

export const BACKUP_VERSION = 1

export interface BackupData {
  configs: ApiConfig[]
  parameters: ModelParameters
  settings: Settings
  sessions: ChatSession[]
}

/** Build a backup carrying only the sections implied by `scope`. */
export function buildBackup(data: BackupData, scope: BackupScope): BackupFile {
  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    scope,
  }
  if (scope === 'all' || scope === 'configs') {
    backup.configs = data.configs
    backup.parameters = data.parameters
    backup.settings = data.settings
  }
  if (scope === 'all' || scope === 'chats') {
    backup.sessions = data.sessions
  }
  return backup
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * A defensively-validated backup. Sections absent from the file are returned
 * as `undefined` so the importer can replace only what's present. Throws only
 * on irrecoverably corrupt input (invalid JSON / non-object root).
 */
export function parseBackup(raw: string): BackupFile {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('File is not valid JSON.')
  }
  if (!isObject(json)) throw new Error('Backup is not an object.')

  const hasConfigs = 'configs' in json
  const hasSessions = 'sessions' in json

  const configs = hasConfigs ? sanitizeConfigs(json.configs) : undefined
  const sessions = hasSessions ? sanitizeSessions(json.sessions) : undefined
  const parameters =
    'parameters' in json ? normalizeParameters(json.parameters) : undefined
  const settings = 'settings' in json ? sanitizeSettings(json.settings) : undefined

  // Infer scope: explicit field wins; otherwise derive from present sections.
  let scope: BackupScope
  if (
    json.scope === 'all' ||
    json.scope === 'configs' ||
    json.scope === 'chats'
  ) {
    scope = json.scope
  } else if (hasConfigs && hasSessions) {
    scope = 'all'
  } else if (hasSessions) {
    scope = 'chats'
  } else {
    scope = 'configs'
  }

  return {
    version: typeof json.version === 'number' ? json.version : BACKUP_VERSION,
    exportedAt:
      typeof json.exportedAt === 'number' ? json.exportedAt : Date.now(),
    scope,
    configs,
    parameters,
    settings,
    sessions,
  }
}

function sanitizeConfigs(value: unknown): ApiConfig[] {
  if (!Array.isArray(value)) return []
  const valid: ApiConfig[] = []
  for (const c of value) {
    if (!isObject(c)) continue
    if (typeof c.id !== 'string') continue
    const type =
      c.type === 'gemini' || c.type === 'claude' ? c.type : 'openai'
    valid.push({
      id: c.id,
      name: typeof c.name === 'string' ? c.name : 'Untitled',
      baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : '',
      apiKey: typeof c.apiKey === 'string' ? c.apiKey : '',
      modelId: typeof c.modelId === 'string' ? c.modelId : '',
      type,
    })
  }
  return valid
}

function sanitizeSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return []
  const valid: ChatSession[] = []
  for (const s of value) {
    if (!isObject(s)) continue
    if (typeof s.id !== 'string') continue
    const messages = Array.isArray(s.messages)
      ? s.messages.filter(
          (m): m is Record<string, unknown> =>
            isObject(m) &&
            typeof m.id === 'string' &&
            (m.role === 'user' ||
              m.role === 'assistant' ||
              m.role === 'system'),
        )
      : []
    valid.push({
      id: s.id,
      title: typeof s.title === 'string' ? s.title : 'Untitled',
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      ...(typeof s.lastUsedConfigId === 'string'
        ? { lastUsedConfigId: s.lastUsedConfigId }
        : {}),
      // Trust message shape after the minimal guard above.
      messages: messages as unknown as ChatSession['messages'],
    })
  }
  return valid
}

function sanitizeSettings(value: unknown): Settings {
  if (!isObject(value)) return { ...DEFAULT_SETTINGS }
  const merged = { ...DEFAULT_SETTINGS, ...(value as Partial<Settings>) }
  // Guard enum-like fields.
  if (merged.theme !== 'light' && merged.theme !== 'dark')
    merged.theme = DEFAULT_SETTINGS.theme
  if (merged.language !== 'en' && merged.language !== 'zh')
    merged.language = DEFAULT_SETTINGS.language
  return merged
}
