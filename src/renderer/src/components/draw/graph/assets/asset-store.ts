import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface AssetItem {
  id: string
  filePath: string
  mediaType?: string
  prompt?: string
  createdAt: number
  kind?: 'image' | 'video'
}

interface AssetState {
  items: AssetItem[]
  addAsset: (item: {
    filePath: string
    mediaType?: string
    prompt?: string
    createdAt: number
    kind?: 'image' | 'video'
  }) => void
  removeAsset: (id: string) => void
  clear: () => void
}

/**
 * "My materials" library. Only lightweight metadata is persisted — the image
 * bytes already live on disk at `filePath` (persisted by image generation), so
 * the picker rehydrates thumbnails from disk on open.
 */
export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      items: [],
      addAsset: (item) => {
        if (!item.filePath || get().items.some((a) => a.filePath === item.filePath)) return
        set((s) => ({ items: [{ id: nanoid(), ...item }, ...s.items] }))
      },
      removeAsset: (id) => set((s) => ({ items: s.items.filter((a) => a.id !== id) })),
      clear: () => set({ items: [] })
    }),
    { name: 'open-cowork.draw.assets' }
  )
)
