import { useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { streamChat } from '@/lib/apiClient'
import { runAgenticCompletion } from '@/lib/agent'
import { activePath } from '@/lib/messageTree'
import { uid } from '@/lib/utils'
import type { ApiConfig, Attachment, Message } from '@/types'

/**
 * High-level chat controller. Bridges the UI to the streaming API client and
 * keeps the Zustand store updated as tokens arrive.
 */
export function useStream() {
  const isGenerating = useAppStore((s) => s.isGenerating)

  const runCompletion = useCallback(
    async (sessionId: string, config: ApiConfig, history: Message[]) => {
      const store = useAppStore.getState()
      const assistantId = uid('msg_')
      store.addMessage(sessionId, {
        id: assistantId,
        parentId: history.at(-1)?.id ?? null,
        role: 'assistant',
        content: '',
        reasoning: '',
        timestamp: Date.now(),
        model: config.name,
        isStreaming: true,
      })
      store.setSessionModel(sessionId, config.id)

      const controller = new AbortController()
      store.setAbortController(controller)
      store.setGenerating(true)

      const { searchSettings, searchConfigs } = store
      const webSearchActive =
        searchSettings.enabled && searchConfigs.length > 0

      try {
        if (webSearchActive) {
          await runAgenticCompletion({
            sessionId,
            assistantId,
            config,
            parameters: store.parameters,
            baseHistory: history,
            corsProxy: store.settings.corsProxy,
            signal: controller.signal,
            searchConfigs,
            searchSettings,
          })
        } else {
          await streamChat({
            config,
            parameters: store.parameters,
            messages: history,
            corsProxy: store.settings.corsProxy,
            signal: controller.signal,
            callbacks: {
              onContent: (delta) =>
                useAppStore
                  .getState()
                  .appendToMessage(sessionId, assistantId, { content: delta }),
              onReasoning: (delta) =>
                useAppStore
                  .getState()
                  .appendToMessage(sessionId, assistantId, { reasoning: delta }),
              onTransaction: (tx) =>
                useAppStore
                  .getState()
                  .updateMessage(sessionId, assistantId, { transaction: tx }),
              onError: (message) =>
                useAppStore
                  .getState()
                  .updateMessage(sessionId, assistantId, { error: message }),
              onDone: () => {},
            },
          })
        }
      } finally {
        const s = useAppStore.getState()
        s.updateMessage(sessionId, assistantId, { isStreaming: false })
        s.setGenerating(false)
        s.setAbortController(null)
      }
    },
    [],
  )

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      const store = useAppStore.getState()
      const config = store.configs.find(
        (c) => c.id === store.settings.activeConfigId,
      )
      if (!config) return false
      if (!text.trim() && attachments.length === 0) return false

      const sessionId = store.ensureActiveSession()
      const userMsg: Message = {
        id: uid('msg_'),
        role: 'user',
        content: text,
        attachments: attachments.length ? attachments : undefined,
        timestamp: Date.now(),
      }
      store.addMessage(sessionId, userMsg)

      const fresh = useAppStore
        .getState()
        .sessions.find((s) => s.id === sessionId)
      const history = fresh
        ? activePath(fresh.messages, fresh.currentLeafId)
        : [userMsg]
      await runCompletion(sessionId, config, history)
      return true
    },
    [runCompletion],
  )

  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      const store = useAppStore.getState()
      const config = store.configs.find(
        (c) => c.id === store.settings.activeConfigId,
      )
      if (!config || !store.activeSessionId) return
      const session = store.sessions.find(
        (s) => s.id === store.activeSessionId,
      )
      if (!session) return
      const target = session.messages.find((m) => m.id === assistantMessageId)
      if (!target) return

      // History = path up to and including the message this reply forks from.
      const parentId = target.parentId ?? null
      const history = parentId
        ? activePath(session.messages, parentId)
        : []
      // runCompletion appends a new assistant node parented at `parentId`,
      // creating a sibling of the old reply and switching the visible branch.
      await runCompletion(session.id, config, history)
    },
    [runCompletion],
  )

  const editUserMessage = useCallback(
    async (userMessageId: string, text: string) => {
      const store = useAppStore.getState()
      const config = store.configs.find(
        (c) => c.id === store.settings.activeConfigId,
      )
      if (!config || !store.activeSessionId) return
      if (!text.trim()) return
      const session = store.sessions.find(
        (s) => s.id === store.activeSessionId,
      )
      if (!session) return
      const original = session.messages.find((m) => m.id === userMessageId)
      if (!original || original.role !== 'user') return

      // Sibling of the original user message: same parent, new content.
      const newUserMsg: Message = {
        id: uid('msg_'),
        parentId: original.parentId ?? null,
        role: 'user',
        content: text,
        attachments: original.attachments,
        timestamp: Date.now(),
      }
      store.addMessage(session.id, newUserMsg)

      const fresh = useAppStore
        .getState()
        .sessions.find((s) => s.id === session.id)
      const history = fresh
        ? activePath(fresh.messages, fresh.currentLeafId)
        : [newUserMsg]
      await runCompletion(session.id, config, history)
    },
    [runCompletion],
  )

  const stop = useCallback(() => {
    useAppStore.getState().stopGeneration()
  }, [])

  return { send, regenerate, editUserMessage, stop, isGenerating }
}
