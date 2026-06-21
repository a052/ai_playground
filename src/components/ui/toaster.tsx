import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToast } from '@/store/useToast'
import { cn } from '@/lib/utils'

const icons = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
}

export function Toaster() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.variant]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={() => dismiss(t.id)}
              className={cn(
                'pointer-events-auto flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-popover px-3.5 py-2.5 text-sm shadow-lg',
                t.variant === 'success' && 'border-brand/40',
                t.variant === 'error' && 'border-destructive/50',
                t.variant === 'default' && 'border-border',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  t.variant === 'success' && 'text-brand',
                  t.variant === 'error' && 'text-destructive',
                  t.variant === 'default' && 'text-muted-foreground',
                )}
              />
              <span className="text-popover-foreground">{t.message}</span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
