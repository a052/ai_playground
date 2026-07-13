import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, type ChangeEvent, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { confirm } from '@/store/useConfirm'
import { cn } from '@/lib/utils'
import type { Language, SearchDepth, ThemeMode } from '@/types'

export function SettingsDialog() {
  const t = useT()
  const open = useUiStore((s) => s.settingsOpen)
  const setOpen = useUiStore((s) => s.setSettingsOpen)

  const openExportDialog = useUiStore((s) => s.openExportDialog)

  const settings = useAppStore((s) => s.settings)
  const setTheme = useAppStore((s) => s.setTheme)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const setCorsProxy = useAppStore((s) => s.setCorsProxy)
  const importBackup = useAppStore((s) => s.importBackup)
  const clearAll = useAppStore((s) => s.clearAll)

  const searchConfigs = useAppStore((s) => s.searchConfigs)
  const searchSettings = useAppStore((s) => s.searchSettings)
  const setSearchSettings = useAppStore((s) => s.setSearchSettings)
  const setActiveSearchConfig = useAppStore((s) => s.setActiveSearchConfig)
  const removeSearchConfig = useAppStore((s) => s.removeSearchConfig)
  const openSearchEditor = useUiStore((s) => s.openSearchEditor)

  const importRef = useRef<HTMLInputElement>(null)

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      importBackup(await file.text())
      toast.success(t('toast.imported'))
    } catch {
      toast.error(t('toast.importFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>{t('app.tagline')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Appearance */}
          <Group title={t('settings.appearance')}>
            <Row label={t('settings.theme')}>
              <Select
                value={settings.theme}
                onValueChange={(v) => setTheme(v as ThemeMode)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
                  <SelectItem value="light">
                    {t('settings.themeLight')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label={t('settings.language')}>
              <Select
                value={settings.language}
                onValueChange={(v) => setLanguage(v as Language)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">简体中文</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </Group>

          {/* CORS */}
          <Group title={t('settings.cors')}>
            <Input
              value={settings.corsProxy}
              onChange={(e) => setCorsProxy(e.target.value)}
              placeholder={t('settings.corsPlaceholder')}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('settings.corsDesc')}
            </p>
          </Group>

          {/* Web Search */}
          <Group title={t('settings.webSearch')}>
            <Row label={t('settings.webSearchEnable')}>
              <Switch
                checked={searchSettings.enabled}
                onCheckedChange={(v) => setSearchSettings({ enabled: v })}
              />
            </Row>

            <div className="space-y-1.5">
              {searchConfigs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.searchNoProvider')}
                </p>
              ) : (
                searchConfigs.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                      searchSettings.activeConfigId === c.id
                        ? 'border-brand/50 bg-brand/5'
                        : 'border-border',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveSearchConfig(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={cn(
                          'h-3 w-3 shrink-0 rounded-full border',
                          searchSettings.activeConfigId === c.id
                            ? 'border-brand bg-brand'
                            : 'border-muted-foreground',
                        )}
                      />
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        {c.provider}
                      </span>
                      <span className="truncate">{c.name}</span>
                    </button>
                    <Tip label={t('search.edit')}>
                      <button
                        type="button"
                        onClick={() => openSearchEditor(c.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tip>
                    <Tip label={t('search.delete')}>
                      <button
                        type="button"
                        onClick={() =>
                          confirm({
                            title: t('search.delete'),
                            description: t('search.deleteDesc'),
                            confirmLabel: t('search.delete'),
                            onConfirm: () => removeSearchConfig(c.id),
                          })
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tip>
                  </div>
                ))
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => openSearchEditor()}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('search.add')}
              </Button>
            </div>

            <Row label={t('settings.searchDepth')}>
              <Select
                value={searchSettings.depth}
                onValueChange={(v) =>
                  setSearchSettings({ depth: v as SearchDepth })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="snippets">
                    {t('settings.searchDepthSnippets')}
                  </SelectItem>
                  <SelectItem value="fetch_top_n">
                    {t('settings.searchDepthFetch')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Row>
            {searchSettings.depth === 'fetch_top_n' && (
              <Row label={t('settings.topN')}>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={searchSettings.topN}
                  onChange={(e) =>
                    setSearchSettings({ topN: Number(e.target.value) || 1 })
                  }
                  className="w-20"
                />
              </Row>
            )}
            <Row label={t('settings.maxResults')}>
              <Input
                type="number"
                min={1}
                max={20}
                value={searchSettings.maxResults}
                onChange={(e) =>
                  setSearchSettings({ maxResults: Number(e.target.value) || 1 })
                }
                className="w-20"
              />
            </Row>
            <Row label={t('settings.maxIterations')}>
              <Input
                type="number"
                min={1}
                max={12}
                value={searchSettings.maxIterations}
                onChange={(e) =>
                  setSearchSettings({
                    maxIterations: Number(e.target.value) || 1,
                  })
                }
                className="w-20"
              />
            </Row>
            <Row label={t('settings.maxPageChars')}>
              <Input
                type="number"
                min={1000}
                step={1000}
                value={searchSettings.maxPageChars}
                onChange={(e) =>
                  setSearchSettings({
                    maxPageChars: Number(e.target.value) || 1000,
                  })
                }
                className="w-28"
              />
            </Row>
          </Group>

          {/* Data */}
          <Group title={t('settings.dataManagement')}>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onImportFile}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => {
                  setOpen(false)
                  openExportDialog()
                }}
              >
                <Download className="h-3.5 w-3.5" />
                {t('sidebar.export')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => importRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {t('sidebar.import')}
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="w-full gap-1.5"
              onClick={() =>
                confirm({
                  title: t('settings.clearAll'),
                  description: t('settings.clearAllConfirm'),
                  confirmLabel: t('settings.clearAll'),
                  onConfirm: async () => {
                    await clearAll()
                    setOpen(false)
                  },
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('settings.clearAll')}
            </Button>
          </Group>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
