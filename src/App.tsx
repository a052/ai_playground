import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { ChatWindow } from '@/components/ChatWindow'
import { ParameterPanel } from '@/components/ParameterPanel'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ApiEditorDialog } from '@/components/ApiEditorDialog'
import { ExportDialog } from '@/components/ExportDialog'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'

const PANEL_SPRING = { type: 'spring', stiffness: 380, damping: 38 } as const

function App() {
  const hydrate = useAppStore((s) => s.hydrate)
  const hydrated = useAppStore((s) => s.hydrated)
  const theme = useAppStore((s) => s.settings.theme)
  const language = useAppStore((s) => s.settings.language)

  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const paramPanelOpen = useUiStore((s) => s.paramPanelOpen)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  if (!hydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Left sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={PANEL_SPRING}
              className="z-20 h-full shrink-0 overflow-hidden"
            >
              <div className="h-full w-64">
                <Sidebar />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Center chat */}
        <ChatWindow />

        {/* Right parameter panel */}
        <AnimatePresence initial={false}>
          {paramPanelOpen && (
            <motion.aside
              key="params"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={PANEL_SPRING}
              className="z-20 h-full shrink-0 overflow-hidden border-l border-border bg-card/40"
            >
              <div className="h-full w-80">
                <ParameterPanel />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <SettingsDialog />
      <ApiEditorDialog />
      <ExportDialog />
      <Toaster />
    </TooltipProvider>
  )
}

export default App
