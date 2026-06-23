import { create } from 'zustand'

interface UiState {
  sidebarOpen: boolean
  paramPanelOpen: boolean
  settingsOpen: boolean
  apiEditorOpen: boolean
  searchEditorOpen: boolean
  exportDialogOpen: boolean
  /** Config id being edited; null means "create new". */
  editingConfigId: string | null
  /** Search-config id being edited; null means "create new". */
  editingSearchConfigId: string | null

  toggleSidebar: () => void
  setSidebar: (open: boolean) => void
  toggleParamPanel: () => void
  setParamPanel: (open: boolean) => void
  openSettings: () => void
  setSettingsOpen: (open: boolean) => void
  openApiEditor: (configId?: string | null) => void
  setApiEditorOpen: (open: boolean) => void
  openSearchEditor: (configId?: string | null) => void
  setSearchEditorOpen: (open: boolean) => void
  openExportDialog: () => void
  setExportDialogOpen: (open: boolean) => void
}

const isDesktop =
  typeof window !== 'undefined' ? window.innerWidth >= 1024 : true

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: isDesktop,
  paramPanelOpen: isDesktop,
  settingsOpen: false,
  apiEditorOpen: false,
  searchEditorOpen: false,
  exportDialogOpen: false,
  editingConfigId: null,
  editingSearchConfigId: null,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebar: (open) => set({ sidebarOpen: open }),
  toggleParamPanel: () => set((s) => ({ paramPanelOpen: !s.paramPanelOpen })),
  setParamPanel: (open) => set({ paramPanelOpen: open }),
  openSettings: () => set({ settingsOpen: true }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openApiEditor: (configId = null) =>
    set({ apiEditorOpen: true, editingConfigId: configId }),
  setApiEditorOpen: (open) => set({ apiEditorOpen: open }),
  openSearchEditor: (configId = null) =>
    set({ searchEditorOpen: true, editingSearchConfigId: configId }),
  setSearchEditorOpen: (open) => set({ searchEditorOpen: open }),
  openExportDialog: () => set({ exportDialogOpen: true }),
  setExportDialogOpen: (open) => set({ exportDialogOpen: open }),
}))
