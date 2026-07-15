import { create } from 'zustand'

interface AssistantState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

/** Transient UI flag for the canvas assistant panel (not persisted). */
export const useAssistantStore = create<AssistantState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open }))
}))
