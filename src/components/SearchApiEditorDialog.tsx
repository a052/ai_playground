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
import { SEARCH_TEMPLATES, emptySearchConfig } from '@/lib/defaults'
import { cn } from '@/lib/utils'
import type { SearchConfig, SearchProvider } from '@/types'

export function SearchApiEditorDialog() {
  const t = useT()
  const open = useUiStore((s) => s.searchEditorOpen)
  const setOpen = useUiStore((s) => s.setSearchEditorOpen)
  const editingId = useUiStore((s) => s.editingSearchConfigId)

  const searchConfigs = useAppStore((s) => s.searchConfigs)
  const addSearchConfig = useAppStore((s) => s.addSearchConfig)
  const updateSearchConfig = useAppStore((s) => s.updateSearchConfig)
  const setActiveSearchConfig = useAppStore((s) => s.setActiveSearchConfig)

  const [draft, setDraft] = useState<SearchConfig>(emptySearchConfig())
  const [showKey, setShowKey] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  const currentSession = open ? (editingId ?? '__new__') : null
  if (currentSession !== openedFor) {
    setOpenedFor(currentSession)
    if (open) {
      const existing = editingId
        ? searchConfigs.find((c) => c.id === editingId)
        : undefined
      setDraft(existing ? { ...existing } : emptySearchConfig())
      setShowKey(false)
    }
  }

  const isEditing = !!editingId
  const patch = (p: Partial<SearchConfig>) => setDraft((d) => ({ ...d, ...p }))

  const applyTemplate = (provider: SearchProvider, label: string) => {
    const nameIsAuto =
      !draft.name || SEARCH_TEMPLATES.some((x) => x.label === draft.name)
    patch({ provider, name: nameIsAuto ? label : draft.name })
  }

  const save = () => {
    if (!draft.name.trim()) {
      toast.error(t('search.required'))
      return
    }
    if (draft.provider === 'custom' && !draft.baseUrl?.trim()) {
      toast.error(t('search.endpointRequired'))
      return
    }
    if (isEditing) {
      updateSearchConfig(draft.id, draft)
    } else {
      addSearchConfig(draft)
      setActiveSearchConfig(draft.id)
    }
    setOpen(false)
  }

  const isCustom = draft.provider === 'custom'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('search.edit') : t('search.add')}
          </DialogTitle>
          <DialogDescription>{t('search.editorDesc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {SEARCH_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => applyTemplate(tpl.provider, tpl.label)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                draft.provider === tpl.provider
                  ? 'border-brand/50 bg-brand/10 text-foreground'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:border-brand/50 hover:text-foreground',
              )}
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <div className="space-y-3.5">
          <FormRow label={t('search.name')}>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('search.namePlaceholder')}
            />
          </FormRow>

          <FormRow label={t('search.provider')}>
            <Select
              value={draft.provider}
              onValueChange={(v) => patch({ provider: v as SearchProvider })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tavily">Tavily</SelectItem>
                <SelectItem value="brave">Brave</SelectItem>
                <SelectItem value="serper">Serper</SelectItem>
                <SelectItem value="exa">Exa</SelectItem>
                <SelectItem value="custom">{t('search.providerCustom')}</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow
            label={isCustom ? t('search.endpoint') : t('search.endpointOptional')}
          >
            <Input
              value={draft.baseUrl ?? ''}
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/search"
              className="font-mono text-xs"
            />
          </FormRow>

          <FormRow label={t('search.apiKey')}>
            <div className="relative">
              <Input
                type="text"
                value={draft.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder="…"
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

          <FormRow label={t('search.extraParams')}>
            <textarea
              value={draft.extraParams ?? ''}
              onChange={(e) => patch({ extraParams: e.target.value })}
              placeholder='{"country": "us"}'
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none scrollbar-thin placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
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
