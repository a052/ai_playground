import { memo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Pencil,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { ReasoningBlock } from '@/components/ReasoningBlock'
import { ImageLightbox } from '@/components/ImageLightbox'
import { ToolCallCard } from '@/components/ToolCallCard'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Tip } from '@/components/ui/tip'
import { useT } from '@/i18n'
import type { Attachment, HttpTransaction, Message } from '@/types'
import type { SiblingInfo } from '@/lib/messageTree'
import { cn, formatBytes, formatDateTime, formatTime } from '@/lib/utils'

interface ChatMessageProps {
  message: Message
  /** Sibling/branch info; present only when this message has >1 sibling. */
  branch?: SiblingInfo
  onSwitchBranch?: (targetId: string) => void
  onRegenerate?: () => void
  onEdit?: (text: string) => void
  onViewRaw?: () => void
  onInspectTx?: (tx: HttpTransaction) => void
  onDelete?: () => void
}

export const ChatMessage = memo(function ChatMessage({
  message,
  branch,
  onSwitchBranch,
  onRegenerate,
  onEdit,
  onViewRaw,
  onInspectTx,
  onDelete,
}: ChatMessageProps) {
  const t = useT()
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }
  const cancelEdit = () => setEditing(false)
  const saveEdit = () => {
    const text = draft.trim()
    setEditing(false)
    if (text && text !== message.content) onEdit?.(text)
  }

  const switchTo = (delta: number) => {
    if (!branch || !onSwitchBranch) return
    const next = branch.index + delta
    if (next < 0 || next >= branch.total) return
    onSwitchBranch(branch.siblingIds[next])
  }

  const showEmptyStreaming =
    message.isStreaming && !message.content && !message.reasoning

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="group flex w-full flex-col gap-1"
    >
      <div className="flex w-full min-w-0 flex-col gap-1">
        {/* meta */}
        <div
          className={cn(
            'flex items-center gap-2 px-1 text-[11px] text-muted-foreground',
            isUser ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
              isUser
                ? 'border-border bg-secondary'
                : 'border-brand/30 bg-brand/10 text-brand',
            )}
          >
            {isUser ? (
              <User className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="font-medium text-foreground/80">
            {isUser ? t('chat.you') : message.model || t('chat.assistant')}
          </span>
          <Tip label={formatDateTime(message.timestamp)}>
            <span className="cursor-default">{formatTime(message.timestamp)}</span>
          </Tip>
        </div>

        {/* attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div
            className={cn(
              'flex flex-wrap gap-2',
              isUser ? 'justify-end' : 'justify-start',
            )}
          >
            {message.attachments.map((a) => (
              <AttachmentPreview key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {/* agentic tool rounds */}
        {!isUser && message.toolRounds && message.toolRounds.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            {message.toolRounds.map((round, ri) => {
              const inspectRound =
                onInspectTx && round.transaction
                  ? () => onInspectTx(round.transaction!)
                  : undefined
              return (
                <div key={ri} className="flex flex-col gap-2">
                  {round.reasoning ? (
                    <ReasoningBlock
                      reasoning={round.reasoning}
                      streaming={false}
                      onViewRaw={inspectRound}
                    />
                  ) : (
                    inspectRound && (
                      <div className="flex">
                        <button
                          type="button"
                          onClick={inspectRound}
                          className="flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Terminal className="h-3.5 w-3.5" />
                          {t('chat.viewOriginal')}
                        </button>
                      </div>
                    )
                  )}
                  {round.content && (
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                      {round.content}
                    </p>
                  )}
                  {round.toolCalls.map((tc) => (
                    <ToolCallCard
                      key={tc.id}
                      toolCall={tc}
                      onInspect={
                        onInspectTx ? (tx) => tx && onInspectTx(tx) : undefined
                      }
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* inline editor (user messages) */}
        {editing ? (
          <div className="flex w-full max-w-full flex-col gap-2 self-end rounded-2xl rounded-br-md border border-brand/20 bg-brand/10 p-3">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit()
              }}
              rows={Math.min(12, Math.max(2, draft.split('\n').length))}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                <X className="mr-1 h-3.5 w-3.5" />
                {t('chat.cancel')}
              </Button>
              <Button variant="brand" size="sm" onClick={saveEdit}>
                <Check className="mr-1 h-3.5 w-3.5" />
                {t('chat.save')}
              </Button>
            </div>
          </div>
        ) : (
          /* bubble */
          (message.content ||
            message.reasoning ||
            showEmptyStreaming ||
            message.error) && (
            <div
              className={cn(
                'w-fit max-w-full rounded-2xl border px-4 py-2.5',
                isUser
                  ? 'self-end rounded-br-md border-brand/20 bg-brand/10'
                  : 'self-start rounded-bl-md border-border bg-card',
              )}
            >
            {!isUser && !!message.reasoning && (
              <ReasoningBlock
                reasoning={message.reasoning}
                streaming={message.isStreaming && !message.content}
              />
            )}

            {showEmptyStreaming && (
              <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-brand"
                      animate={{ y: [0, -3, 0] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                      }}
                    />
                  ))}
                </span>
                {t('chat.streaming')}
              </div>
            )}

            {message.content &&
              (isUser ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {message.content}
                </p>
              ) : (
                <>
                  <MarkdownRenderer content={message.content} />
                  {message.isStreaming && <span className="stream-caret" />}
                </>
              ))}

            {message.error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">
                  <span className="font-medium">{t('chat.errorPrefix')}: </span>
                  {message.error}
                </span>
              </div>
            )}
            </div>
          )
        )}

        {/* branch switcher */}
        {branch && branch.total > 1 && !editing && (
          <div
            className={cn(
              'flex flex-row items-center gap-1 px-1 text-[11px] text-muted-foreground',
              isUser ? 'self-end' : 'self-start',
            )}
          >
            <Tip label={t('chat.branchPrev')}>
              <button
                type="button"
                disabled={branch.index === 0}
                onClick={() => switchTo(-1)}
                className="rounded p-0.5 transition-colors hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </Tip>
            <span className="tabular-nums">
              {branch.index + 1}/{branch.total}
            </span>
            <Tip label={t('chat.branchNext')}>
              <button
                type="button"
                disabled={branch.index === branch.total - 1}
                onClick={() => switchTo(1)}
                className="rounded p-0.5 transition-colors hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </div>
        )}

        {/* actions */}
        {!message.isStreaming && !editing && (
          <div
            className={cn(
              'flex items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
              isUser ? 'flex-row-reverse' : 'flex-row',
            )}
          >
            {message.content && (
              <ActionButton
                label={copied ? t('chat.copied') : t('chat.copy')}
                onClick={copy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-brand" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </ActionButton>
            )}
            {isUser && onEdit && (
              <ActionButton label={t('chat.edit')} onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </ActionButton>
            )}
            {!isUser && onRegenerate && (
              <ActionButton label={t('chat.regenerate')} onClick={onRegenerate}>
                <RefreshCw className="h-3.5 w-3.5" />
              </ActionButton>
            )}
            {!isUser && onViewRaw && message.transaction && (
              <ActionButton label={t('chat.viewOriginal')} onClick={onViewRaw}>
                <Terminal className="h-3.5 w-3.5" />
              </ActionButton>
            )}
            {onDelete && (
              <ActionButton label={t('chat.deleteMessage')} onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
})

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const t = useT()
  const [zoom, setZoom] = useState(false)

  if (attachment.kind === 'image') {
    return (
      <>
        <Tip label={t('image.viewOriginal')}>
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="block overflow-hidden rounded-lg border border-border"
          >
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-h-48 cursor-zoom-in object-cover transition hover:opacity-90"
            />
          </button>
        </Tip>
        <ImageLightbox
          src={zoom ? attachment.dataUrl : null}
          alt={attachment.name}
          onClose={() => setZoom(false)}
        />
      </>
    )
  }
  if (attachment.kind === 'audio') {
    return (
      <audio
        controls
        src={attachment.dataUrl}
        className="h-9 w-64 max-w-full"
      />
    )
  }
  if (attachment.kind === 'video') {
    return (
      <video
        controls
        src={attachment.dataUrl}
        className="max-h-64 max-w-full rounded-lg border border-border"
      />
    )
  }
  // document
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[200px] truncate font-medium">
          {attachment.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(attachment.size)}
        </span>
      </div>
    </div>
  )
}
