import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/store/useConfirm'
import { useT } from '@/i18n'

export function ConfirmDialog() {
  const t = useT()
  const open = useConfirm((s) => s.open)
  const options = useConfirm((s) => s.options)
  const pending = useConfirm((s) => s.pending)
  const cancel = useConfirm((s) => s.cancel)
  const accept = useConfirm((s) => s.accept)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent hideClose className="max-w-sm">
        <DialogHeader className="items-center text-center">
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description && (
            <DialogDescription>{options.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={cancel} disabled={pending}>
            {options?.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void accept()}
            disabled={pending}
          >
            {options?.confirmLabel ?? t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
