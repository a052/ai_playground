import { Download, Trash2, Upload } from 'lucide-react'
import { useRef, type ChangeEvent, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { confirm } from '@/store/useConfirm'
import type { Language, ThemeMode } from '@/types'

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
