import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import { ChatMessage } from '@/components/ChatMessage'
import { MessageComposer } from '@/components/MessageComposer'
import { HttpInspectorModal } from '@/components/HttpInspectorModal'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useStream } from '@/hooks/useStream'
import {
  useActiveConfig,
  useActiveSession,
  useAppStore,
} from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import type { HttpTransaction } from '@/types'

const TYPE_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
}

export function ChatWindow() {
  const t = useT()
  const session = useActiveSession()
  const config = useActiveConfig()
  const configs = useAppStore((s) => s.configs)
  const setActiveConfig = useAppStore((s) => s.setActiveConfig)
  const deleteMessage = useAppStore((s) => s.deleteMessage)
  const createSession = useAppStore((s) => s.createSession)

  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const paramPanelOpen = useUiStore((s) => s.paramPanelOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleParamPanel = useUiStore((s) => s.toggleParamPanel)
  const openApiEditor = useUiStore((s) => s.openApiEditor)

  const { send, regenerate, stop, isGenerating } = useStream()

  const [inspectTx, setInspectTx] = useState<HttpTransaction | null>(null)
  const [inspectOpen, setInspectOpen] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const messages = session?.messages ?? []
  const lastContentLen = messages.at(-1)?.content.length ?? 0
  const lastReasoningLen = messages.at(-1)?.reasoning?.length ?? 0

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastContentLen, lastReasoningLen, session?.id])

  const openInspector = (tx: HttpTransaction) => {
    setInspectTx(tx)
    setInspectOpen(true)
  }

  const hasConfig = !!config

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {!sidebarOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleSidebar}
            title={t('sidebar.expand')}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Select
            value={config?.id ?? ''}
            onValueChange={(v) => setActiveConfig(v)}
          >
            <SelectTrigger className="h-8 w-auto max-w-[260px] gap-2 border-border/70 text-sm">
              <SelectValue placeholder={t('chat.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              {configs.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t('sidebar.noModels')}
                </div>
              ) : (
                configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        {TYPE_LABEL[c.type]}
                      </span>
                      {c.name}
                    </span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {config && (
            <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
              {config.modelId}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => createSession()}
          title={t('sidebar.newChat')}
        >
          <Plus className="h-4 w-4" />
        </Button>
        {!paramPanelOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleParamPanel}
            title={t('param.title')}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        )}
      </header>

      {/* messages */}
      <div className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 ? (
          <EmptyState hasConfig={hasConfig} onAddApi={() => openApiEditor()} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                onRegenerate={
                  m.role === 'assistant' && !isGenerating
                    ? () => regenerate(m.id)
                    : undefined
                }
                onViewRaw={
                  m.transaction ? () => openInspector(m.transaction!) : undefined
                }
                onInspectTx={openInspector}
                onDelete={
                  !isGenerating && session
                    ? () => deleteMessage(session.id, m.id)
                    : undefined
                }
              />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border bg-background/60 backdrop-blur">
        <MessageComposer
          onSend={send}
          onStop={stop}
          isGenerating={isGenerating}
          disabled={!hasConfig}
        />
      </div>

      <HttpInspectorModal
        transaction={inspectTx}
        open={inspectOpen}
        onOpenChange={setInspectOpen}
      />
    </div>
  )
}

function EmptyState({
  hasConfig,
  onAddApi,
}: {
  hasConfig: boolean
  onAddApi: () => void
}) {
  const t = useT()
  return (
    <div className="bg-grid flex h-full flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand shadow-sm"
      >
        <Sparkles className="h-7 w-7" />
      </motion.div>
      <h2 className="mt-5 text-lg font-semibold text-balance">
        {hasConfig ? t('chat.emptyTitle') : t('chat.noApiTitle')}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground text-balance">
        {hasConfig ? t('chat.emptySubtitle') : t('chat.noApiSubtitle')}
      </p>
      {!hasConfig && (
        <Button variant="brand" className="mt-5 gap-2" onClick={onAddApi}>
          <PanelRightOpen className="h-4 w-4" />
          {t('chat.addApiCta')}
        </Button>
      )}
    </div>
  )
}
