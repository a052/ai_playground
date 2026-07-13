import { useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, ChevronRight, Terminal } from 'lucide-react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { Tip } from '@/components/ui/tip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface ReasoningBlockProps {
  reasoning: string
  streaming?: boolean
  /** When set, shows a "View raw HTTP" button for the producing model call. */
  onViewRaw?: () => void
}

export function ReasoningBlock({
  reasoning,
  streaming,
  onViewRaw,
}: ReasoningBlockProps) {
  const t = useT()
  const [open, setOpen] = useState(!!streaming)
  const [wasStreaming, setWasStreaming] = useState(streaming)

  // Auto-collapse once the answer starts streaming in (reasoning done). Done
  // during render rather than in an effect (React's "adjust state on prop
  // change" pattern) to avoid a cascading re-render: collapse on the
  // streaming→idle transition. Completed messages start collapsed via the
  // initial state above.
  if (streaming !== wasStreaming) {
    setWasStreaming(streaming)
    if (!streaming) setOpen(false)
  }

  if (!reasoning.trim() && !streaming) return null

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border/70 bg-muted/40">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
        >
          <Brain
            className={cn('h-3.5 w-3.5 shrink-0', streaming && 'text-brand')}
          />
          <span className={cn(streaming && 'text-brand')}>
            {streaming ? t('chat.thinking') : t('chat.reasoning')}
          </span>
          {streaming && (
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1 w-1 rounded-full bg-brand"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </span>
          )}
        </button>
        {onViewRaw && (
          <Tip label={t('chat.viewOriginal')}>
            <button
              type="button"
              onClick={onViewRaw}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t('chat.reasoning')}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="max-h-72 overflow-y-auto scrollbar-thin text-xs text-muted-foreground">
            <MarkdownRenderer content={reasoning} className="text-[13px]" />
          </div>
        </div>
      )}
    </div>
  )
}
