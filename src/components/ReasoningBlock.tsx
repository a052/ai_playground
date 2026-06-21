import { useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, ChevronRight } from 'lucide-react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface ReasoningBlockProps {
  reasoning: string
  streaming?: boolean
}

export function ReasoningBlock({ reasoning, streaming }: ReasoningBlockProps) {
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
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
        <ChevronRight
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
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
