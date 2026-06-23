import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUp,
  Check,
  FileAudio,
  FileText,
  FileVideo,
  Globe,
  ImageIcon,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import { toast } from '@/store/useToast'
import type { Attachment } from '@/types'
import {
  cn,
  detectAttachment,
  fileToDataUrl,
  fileToText,
  formatBytes,
  uid,
} from '@/lib/utils'

const MAX_SIZE = 10 * 1024 * 1024 // 10MB soft limit

interface MessageComposerProps {
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  isGenerating: boolean
  disabled?: boolean
}

export function MessageComposer({
  onSend,
  onStop,
  isGenerating,
  disabled,
}: MessageComposerProps) {
  const t = useT()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const webSearchEnabled = useAppStore((s) => s.searchSettings.enabled)
  const searchConfigs = useAppStore((s) => s.searchConfigs)
  const toggleWebSearch = useAppStore((s) => s.toggleWebSearch)
  const openSettings = useUiStore((s) => s.openSettings)

  const onWebSearchClick = () => {
    if (searchConfigs.length === 0) {
      toast.error(t('chat.webSearchNoProvider'))
      openSettings()
      return
    }
    toggleWebSearch()
  }

  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const addFiles = async (files: FileList | File[]) => {
    const next: Attachment[] = []
    for (const file of Array.from(files)) {
      const detected = detectAttachment(file)
      if (!detected) {
        toast.error(t('chat.unsupportedType', { name: file.name }))
        continue
      }
      if (file.size > MAX_SIZE) {
        toast.error(
          t('chat.fileTooLarge', {
            name: file.name,
            size: formatBytes(file.size),
          }),
        )
      }
      // Text/code documents are read as text; media + native PDF as base64.
      if (detected.isTextDoc) {
        const text = await fileToText(file)
        next.push({
          id: uid('att_'),
          kind: 'document',
          name: file.name,
          mimeType: file.type || 'text/plain',
          dataUrl: '',
          size: file.size,
          text,
        })
      } else {
        const dataUrl = await fileToDataUrl(file)
        next.push({
          id: uid('att_'),
          kind: detected.kind,
          name: file.name,
          mimeType: file.type || (detected.isPdf ? 'application/pdf' : ''),
          dataUrl,
          size: file.size,
        })
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next])
  }

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files)
    e.target.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    const dt = e.clipboardData
    if (!dt) return
    let files: File[] = []
    if (dt.files?.length) {
      files = Array.from(dt.files)
    } else if (dt.items?.length) {
      files = Array.from(dt.items)
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null)
    }
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id))

  const submit = () => {
    if (disabled || isGenerating) return
    if (!text.trim() && attachments.length === 0) return
    onSend(text.trim(), attachments)
    setText('')
    setAttachments([])
    requestAnimationFrame(resize)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative mx-auto w-full max-w-3xl rounded-2xl border bg-card shadow-sm transition-colors',
          dragging ? 'border-brand ring-2 ring-brand/30' : 'border-border',
          disabled && 'opacity-60',
        )}
      >
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand/10 text-sm font-medium text-brand"
            >
              {t('chat.dropHint')}
            </motion.div>
          )}
        </AnimatePresence>

        {/* attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border p-2.5">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRemove={() => removeAttachment(a.id)}
              />
            ))}
          </div>
        )}

        {/* active web-search pill */}
        {webSearchEnabled && (
          <div className="flex items-center gap-1.5 px-2.5 pt-2">
            <span className="flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              <Globe className="h-3 w-3" />
              {t('chat.webSearchOn')}
              <button
                type="button"
                onClick={toggleWebSearch}
                className="ml-0.5 rounded-full hover:bg-brand/20"
                aria-label={t('chat.webSearch')}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <div className="flex items-end gap-2 p-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,audio/*,video/*,application/pdf,text/*,.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.jsonc,.yaml,.yml,.toml,.ini,.xml,.html,.css,.scss,.less,.js,.mjs,.cjs,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cc,.hpp,.cs,.php,.sh,.bash,.sql,.vue,.svelte,.log"
            className="hidden"
            onChange={onFileInput}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                disabled={disabled}
                title={t('chat.tools')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={onWebSearchClick}>
                <Globe className="h-4 w-4" />
                <span className="flex-1">{t('chat.webSearch')}</span>
                {webSearchEnabled && <Check className="h-4 w-4 text-brand" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            title={t('chat.attach')}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <textarea
            ref={textareaRef}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              resize()
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={t('chat.placeholder')}
            className="max-h-[200px] flex-1 resize-none self-center bg-transparent py-2 text-sm leading-relaxed outline-none scrollbar-thin placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />

          {isGenerating ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="shrink-0"
              onClick={onStop}
              title={t('chat.stop')}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="brand"
              size="icon"
              className="shrink-0"
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              onClick={submit}
              title={t('chat.send')}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl px-1 text-center text-[11px] text-muted-foreground">
        {t('chat.enterToSend')}
      </p>
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  const Icon =
    attachment.kind === 'image'
      ? ImageIcon
      : attachment.kind === 'audio'
        ? FileAudio
        : attachment.kind === 'video'
          ? FileVideo
          : FileText
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border bg-secondary/60 py-1.5 pl-2 pr-7 text-xs">
      {attachment.kind === 'image' ? (
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <Icon className="h-4 w-4 text-muted-foreground" />
      )}
      <div className="flex flex-col">
        <span className="max-w-[140px] truncate font-medium">
          {attachment.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatBytes(attachment.size)}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Remove attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
