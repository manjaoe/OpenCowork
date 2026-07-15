import { useEffect } from 'react'
import { useGraphStore } from './graph-store'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/** Canvas keyboard shortcuts (undo/redo, delete, select-all, duplicate, esc). */
export function useGraphKeyboard(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const store = useGraphStore.getState()
      const mod = event.metaKey || event.ctrlKey

      if (event.key === 'Escape') {
        store.clearSelection()
        return
      }

      if (isTypingTarget(event.target)) return

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        store.selectAll()
        return
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        store.duplicateSelection()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (store.selection.length > 0 || store.selectedEdges.length > 0) {
          event.preventDefault()
          store.removeSelected()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
