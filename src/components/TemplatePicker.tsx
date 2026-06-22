import { useState, type ReactNode } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from '@/store/useToast'
import { confirm } from '@/store/useConfirm'
import { useT } from '@/i18n'
import type { PromptTemplate } from '@/types'

interface TemplatePickerProps {
  templates: PromptTemplate[]
  onApply: (content: string) => void
  onAdd: (title: string, content: string) => void
  onUpdate: (id: string, title: string, content: string) => void
  onDelete: (id: string) => void
  /** i18n key for the editor dialog title. */
  labelKey: 'templates.systemPrompt' | 'templates.reasoning'
  disabled?: boolean
}

export function TemplatePicker({
  templates,
  onApply,
  onAdd,
  onUpdate,
  onDelete,
  labelKey,
  disabled,
}: TemplatePickerProps) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  // Seed the draft fields once each time the dialog transitions to open —
  // tracked via a session key so we don't reseed on every render. Matches the
  // pattern used by ApiEditorDialog.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const currentSession = editorOpen ? (editingId ?? '__new__') : null
  if (currentSession !== openedFor) {
    setOpenedFor(currentSession)
    if (editorOpen) {
      if (editingId) {
        const existing = templates.find((tpl) => tpl.id === editingId)
        setDraftTitle(existing?.title ?? '')
        setDraftContent(existing?.content ?? '')
      } else {
        setDraftTitle('')
        setDraftContent('')
      }
    }
  }

  const openAdd = () => {
    setEditingId(null)
    setEditorOpen(true)
  }
  const openEdit = (id: string) => {
    setEditingId(id)
    setEditorOpen(true)
    setMenuOpen(false)
  }
  const save = () => {
    const title = draftTitle.trim()
    if (!title) {
      toast.error(t('templates.titleRequired'))
      return
    }
    if (editingId) {
      onUpdate(editingId, title, draftContent)
    } else {
      onAdd(title, draftContent)
    }
    setEditorOpen(false)
  }
  const apply = (template: PromptTemplate) => {
    onApply(template.content)
    setMenuOpen(false)
  }
  const askDelete = (template: PromptTemplate) => {
    confirm({
      title: t('templates.deleteConfirm'),
      description: t('templates.deleteDesc'),
      onConfirm: () => onDelete(template.id),
    })
  }

  return (
    <>
      <div className="flex items-center gap-0.5">
        <IconBtn
          label={t('templates.add')}
          onClick={openAdd}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
        </IconBtn>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              title={t('templates.select')}
              className="flex items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            {templates.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground/70">
                {t('templates.empty')}
              </div>
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <button
                    type="button"
                    onClick={() => apply(tpl)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={tpl.title}
                  >
                    {tpl.title || t('sidebar.untitled')}
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <IconBtn
                      label={t('templates.edit')}
                      onClick={() => openEdit(tpl.id)}
                    >
                      <Pencil className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn
                      label={t('templates.delete')}
                      onClick={() => askDelete(tpl)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </div>
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('templates.edit') : t(labelKey)}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t('templates.title')}
              </Label>
              <Input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t('templates.titlePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t('templates.content')}
              </Label>
              <Textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={t('templates.contentPlaceholder')}
                className="min-h-[160px] font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="brand" onClick={save}>
              {editingId ? t('common.save') : t('common.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
