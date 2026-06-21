import { Archive, Database, MessageSquare, type LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import { toast } from '@/store/useToast'
import type { BackupScope } from '@/types'

export function ExportDialog() {
  const t = useT()
  const open = useUiStore((s) => s.exportDialogOpen)
  const setOpen = useUiStore((s) => s.setExportDialogOpen)
  const exportBackup = useAppStore((s) => s.exportBackup)

  const choose = (scope: BackupScope) => {
    exportBackup(scope)
    toast.success(t('toast.exported'))
    setOpen(false)
  }

  const options: {
    scope: BackupScope
    icon: LucideIcon
    title: string
    desc: string
  }[] = [
    { scope: 'all', icon: Archive, title: t('export.all'), desc: t('export.allDesc') },
    {
      scope: 'configs',
      icon: Database,
      title: t('export.configs'),
      desc: t('export.configsDesc'),
    },
    {
      scope: 'chats',
      icon: MessageSquare,
      title: t('export.chats'),
      desc: t('export.chatsDesc'),
    },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>{t('export.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map(({ scope, icon: Icon, title, desc }) => (
            <button
              key={scope}
              type="button"
              onClick={() => choose(scope)}
              className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-brand/40 hover:bg-accent"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-brand">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
