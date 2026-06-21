import { useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { streamChat } from '@/lib/apiClient'
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
        role: 'assistant',
        content: '',
        reasoning: '',
        timestamp: Date.now(),
        model: config.name,
        isStreaming: true,
      })

      const controller = new AbortController()
      store.setAbortController(controller)
      store.setGenerating(true)

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
          onDone: () => {
            const s = useAppStore.getState()
            s.updateMessage(sessionId, assistantId, { isStreaming: false })
            s.setGenerating(false)
            s.setAbortController(null)
          },
        },
      })
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
      const history = fresh ? fresh.messages.slice() : [userMsg]
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
      const idx = session.messages.findIndex((m) => m.id === assistantMessageId)
      if (idx === -1) return

      const history = session.messages.slice(0, idx)
      store.deleteMessage(session.id, assistantMessageId)
      await runCompletion(session.id, config, history)
    },
    [runCompletion],
  )

  const stop = useCallback(() => {
    useAppStore.getState().stopGeneration()
  }, [])

  return { send, regenerate, stop, isGenerating }
}
