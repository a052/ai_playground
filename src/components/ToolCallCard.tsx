import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Globe,
  Link2,
  Loader2,
  Terminal,
} from 'lucide-react'
import { useT } from '@/i18n'
import { Tip } from '@/components/ui/tip'
import type { FetchedPage, SearchResult, ToolCall } from '@/types'
import { cn } from '@/lib/utils'

interface ToolCallCardProps {
  toolCall: ToolCall
  onInspect?: (tx: ToolCall['transaction']) => void
}

export function ToolCallCard({ toolCall, onInspect }: ToolCallCardProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  const isSearch = toolCall.name === 'web_search'
  const Icon = isSearch ? Globe : Link2
  const subtitle = isSearch
    ? String(toolCall.args.query ?? '')
    : String(toolCall.args.url ?? '')

  const title = isSearch
    ? toolCall.status === 'running'
      ? t('chat.searching')
      : t('chat.webSearch')
    : toolCall.status === 'running'
      ? t('chat.reading')
      : t('chat.fetchUrl')

  const results = Array.isArray(toolCall.resultData)
    ? (toolCall.resultData as SearchResult[])
    : null
  const page =
    toolCall.resultData && !Array.isArray(toolCall.resultData)
      ? (toolCall.resultData as FetchedPage)
      : null
  const hasDetail = !!results?.length || !!page || !!toolCall.error

  return (
    <div className="rounded-xl border border-border bg-card/60 text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground/80">{title}</span>
        {subtitle && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {subtitle}
          </span>
        )}
        {!subtitle && <span className="flex-1" />}

        <StatusIcon status={toolCall.status} />

        {toolCall.transaction && onInspect && (
          <Tip label={t('chat.viewOriginal')}>
            <button
              type="button"
              onClick={() => onInspect(toolCall.transaction)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Terminal className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}
        {hasDetail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Toggle details"
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        )}
      </div>

      {open && hasDetail && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {toolCall.error && (
            <p className="text-destructive">{toolCall.error}</p>
          )}
          {results?.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
            >
              <div className="truncate font-medium text-foreground/90">
                {r.title || r.url}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {r.url}
              </div>
              {r.snippet && (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                  {r.snippet}
                </p>
              )}
            </a>
          ))}
          {page && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase">
                  {page.via}
                </span>
                <span className="truncate">{page.url}</span>
              </div>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-muted-foreground scrollbar-thin">
                {page.text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'running')
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
  if (status === 'error')
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  if (status === 'done')
    return <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
  return null
}
