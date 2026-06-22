import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Copy,
  Download,
  Globe,
  MessageSquarePlus,
  Moon,
  Pencil,
  PanelLeftClose,
  Plus,
  Settings,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import { toast } from '@/store/useToast'
import { confirm } from '@/store/useConfirm'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
}

export function Sidebar() {
  const t = useT()
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const openSession = useAppStore((s) => s.openSession)
  const createSession = useAppStore((s) => s.createSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const renameSession = useAppStore((s) => s.renameSession)

  const configs = useAppStore((s) => s.configs)
  const activeConfigId = useAppStore((s) => s.settings.activeConfigId)
  const setActiveConfig = useAppStore((s) => s.setActiveConfig)
  const removeConfig = useAppStore((s) => s.removeConfig)
  const duplicateConfig = useAppStore((s) => s.duplicateConfig)

  const theme = useAppStore((s) => s.settings.theme)
  const language = useAppStore((s) => s.settings.language)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const importBackup = useAppStore((s) => s.importBackup)

  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const openApiEditor = useUiStore((s) => s.openApiEditor)
  const openSettings = useUiStore((s) => s.openSettings)
  const openExportDialog = useUiStore((s) => s.openExportDialog)

  const importRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setDraft(current)
  }
  const commitRename = () => {
    if (editingId) renameSession(editingId, draft.trim() || t('sidebar.untitled'))
    setEditingId(null)
  }

  const handleOpenSession = (id: string) => {
    const r = openSession(id)
    if (r.status === 'switched') {
      toast.info(t('toast.sessionModelSwitched', { model: r.modelName! }))
    } else if (r.status === 'missing') {
      toast.info(
        r.modelName
          ? t('toast.sessionModelMissing', { model: r.modelName })
          : t('toast.sessionModelUnavailable'),
      )
    }
  }

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      importBackup(text)
      toast.success(t('toast.imported'))
    } catch {
      toast.error(t('toast.importFailed'))
    }
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card/40">
      {/* brand / header */}
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <span className="font-mono text-xs font-bold">AI</span>
          </div>
          <span className="text-sm font-semibold">{t('app.title')}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleSidebar}
          title={t('sidebar.collapse')}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => createSession()}
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t('sidebar.newChat')}
        </Button>
      </div>

      {/* scroll region: chats + apis */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2">
        {/* Chats */}
        <SectionLabel>{t('sidebar.chats')}</SectionLabel>
        <div className="mb-3 space-y-0.5">
          {sessions.length === 0 ? (
            <EmptyHint>{t('sidebar.noChats')}</EmptyHint>
          ) : (
            sessions.map((s) => {
              const active = s.id === activeSessionId
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  {editingId === s.id ? (
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="h-6 px-1 py-0 text-sm"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenSession(s.id)}
                        className="min-w-0 flex-1 truncate text-left"
                      >
                        {s.title || t('sidebar.untitled')}
                      </button>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <IconBtn
                          label={t('sidebar.rename')}
                          onClick={() => startRename(s.id, s.title)}
                        >
                          <Pencil className="h-3 w-3" />
                        </IconBtn>
                        <IconBtn
                          label={t('sidebar.delete')}
                          onClick={() =>
                            confirm({
                              title: t('sidebar.deleteChatConfirm'),
                              description: t('confirm.deleteChatDesc'),
                              onConfirm: () => deleteSession(s.id),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </IconBtn>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* APIs */}
        <div className="flex items-center justify-between pr-1">
          <SectionLabel>{t('sidebar.models')}</SectionLabel>
          <IconBtn label={t('sidebar.addModel')} onClick={() => openApiEditor()}>
            <Plus className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
        <div className="space-y-0.5">
          {configs.length === 0 ? (
            <EmptyHint>{t('sidebar.noModels')}</EmptyHint>
          ) : (
            configs.map((c) => {
              const active = c.id === activeConfigId
              return (
                <ContextMenu key={c.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveConfig(c.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            active ? 'bg-brand' : 'bg-muted-foreground/30',
                          )}
                        />
                        <span className="min-w-0 truncate">{c.name}</span>
                        <span className="ml-auto shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                          {TYPE_LABEL[c.type]}
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <IconBtn
                          label={t('api.edit')}
                          onClick={() => openApiEditor(c.id)}
                        >
                          <Pencil className="h-3 w-3" />
                        </IconBtn>
                        <IconBtn
                          label={t('sidebar.delete')}
                          onClick={() =>
                            confirm({
                              title: t('sidebar.deleteModelConfirm'),
                              description: t('confirm.deleteModelDesc'),
                              onConfirm: () => removeConfig(c.id),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </IconBtn>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => duplicateConfig(c.id)}>
                      <Copy className="h-3.5 w-3.5" />
                      {t('api.duplicate')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })
          )}
        </div>
      </div>

      {/* footer */}
      <div className="shrink-0 border-t border-border p-2">
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFile}
          />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => importRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {t('sidebar.import')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={openExportDialog}
          >
            <Download className="h-3.5 w-3.5" />
            {t('sidebar.export')}
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={openSettings}
          >
            <Settings className="h-4 w-4" />
            {t('sidebar.settings')}
          </Button>
          <div className="flex items-center gap-0.5">
            <IconBtn
              label={language === 'en' ? '中文' : 'English'}
              onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            >
              <span className="flex items-center gap-1 text-xs font-medium">
                <Globe className="h-3.5 w-3.5" />
                {language === 'en' ? 'EN' : '中'}
              </span>
            </IconBtn>
            <IconBtn
              label={theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </IconBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-2 text-xs text-muted-foreground/70">{children}</div>
  )
}

function IconBtn({
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
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
