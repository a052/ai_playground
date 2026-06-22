import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  /** Confirm button label; defaults to `t('common.delete')` at render. */
  confirmLabel?: string
  /** Cancel button label; defaults to `t('common.cancel')` at render. */
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions | null
  /** True while an async `onConfirm` is in flight. */
  pending: boolean
  request: (options: ConfirmOptions) => void
  cancel: () => void
  accept: () => Promise<void>
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  pending: false,
  request: (options) => set({ open: true, options, pending: false }),
  cancel: () => {
    if (get().pending) return
    set({ open: false })
  },
  accept: async () => {
    const { options, pending } = get()
    if (!options || pending) return
    try {
      set({ pending: true })
      await options.onConfirm()
    } finally {
      set({ open: false, pending: false })
    }
  },
}))

/** Imperative helper for non-component code (mirrors `toast`). */
export const confirm = (options: ConfirmOptions) =>
  useConfirm.getState().request(options)
