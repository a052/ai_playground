import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import { toast } from '@/store/useToast'
import { API_TEMPLATES, emptyConfig } from '@/lib/defaults'
import { cn } from '@/lib/utils'
import type { ApiConfig, ApiType } from '@/types'

export function ApiEditorDialog() {
  const t = useT()
  const open = useUiStore((s) => s.apiEditorOpen)
  const setOpen = useUiStore((s) => s.setApiEditorOpen)
  const editingId = useUiStore((s) => s.editingConfigId)

  const configs = useAppStore((s) => s.configs)
  const addConfig = useAppStore((s) => s.addConfig)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setActiveConfig = useAppStore((s) => s.setActiveConfig)

  const [draft, setDraft] = useState<ApiConfig>(emptyConfig())
  const [showKey, setShowKey] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Load the editing target (or a fresh config) whenever the dialog opens or
  // its target changes. Done during render (React's "adjust state on prop
  // change" pattern) rather than in an effect, to avoid a cascading re-render.
  // `open` plus the target id forms the identity of an editing session.
  const currentSession = open ? (editingId ?? '__new__') : null
  if (currentSession !== openedFor) {
    setOpenedFor(currentSession)
    if (open) {
      const existing = editingId
        ? configs.find((c) => c.id === editingId)
        : undefined
      setDraft(existing ? { ...existing } : emptyConfig())
      setShowKey(false)
    }
  }

  const isEditing = !!editingId

  const patch = (p: Partial<ApiConfig>) => setDraft((d) => ({ ...d, ...p }))

  const applyTemplate = (label: string) => {
    const tpl = API_TEMPLATES.find((x) => x.label === label)
    if (!tpl) return
    const nameIsAuto =
      !draft.name || API_TEMPLATES.some((x) => x.label === draft.name)
    patch({
      name: nameIsAuto ? tpl.label : draft.name,
      type: tpl.type,
      baseUrl: tpl.baseUrl,
      modelId: tpl.modelId,
      apiKey: tpl.apiKey ?? draft.apiKey,
    })
  }

  const save = () => {
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.modelId.trim()) {
      toast.error(t('api.required'))
      return
    }
    if (isEditing) {
      updateConfig(draft.id, draft)
    } else {
      addConfig(draft)
      setActiveConfig(draft.id)
    }
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('api.edit') : t('api.add')}</DialogTitle>
          <DialogDescription>{t('api.templates')}</DialogDescription>
        </DialogHeader>

        {/* templates */}
        <div className="flex flex-wrap gap-1.5">
          {API_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => applyTemplate(tpl.label)}
              className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <div className="space-y-3.5">
          <FormRow label={t('api.name')}>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('api.namePlaceholder')}
            />
          </FormRow>

          <FormRow label={t('api.type')}>
            <Select
              value={draft.type}
              onValueChange={(v) => patch({ type: v as ApiType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{t('api.typeOpenai')}</SelectItem>
                <SelectItem value="gemini">{t('api.typeGemini')}</SelectItem>
                <SelectItem value="claude">{t('api.typeClaude')}</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow label={t('api.baseUrl')}>
            <Input
              value={draft.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-xs"
            />
          </FormRow>

          <FormRow label={t('api.modelId')}>
            <Input
              value={draft.modelId}
              onChange={(e) => patch({ modelId: e.target.value })}
              placeholder="gpt-5.5"
              className="font-mono text-xs"
            />
          </FormRow>

          <FormRow label={t('api.apiKey')}>
            <div className="relative">
              <Input
                type="text"
                value={draft.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder="sk-…"
                className={cn(
                  'pr-9 font-mono text-xs',
                  !showKey && 'text-security-disc',
                )}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </FormRow>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('api.cancel')}
          </Button>
          <Button variant="brand" onClick={save}>
            {t('api.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FormRow({
  label,
  children,
}: {
  label: string
  children: import('react').ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
