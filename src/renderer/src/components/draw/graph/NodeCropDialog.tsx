import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Check, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { nodeScreenRect } from './graph-geometry'
import { useGraphStore } from './graph-store'
import { useGraphActions } from './graph-actions'
import { useNodeImage } from './use-node-image'
import { cropImage } from './node-image-ops'
import type { ImageNode } from './graph-types'

interface Props {
  node: ImageNode
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function NodeCropDialog({ node }: Props): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const camera = useGraphStore((s) => s.camera)
  const setEditing = useGraphStore((s) => s.setEditing)
  const actions = useGraphActions()
  const image = useNodeImage(node.data.src)

  const screen = nodeScreenRect(node, camera)
  const [rect, setRect] = useState<Rect | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const clampToImage = useCallback(
    (clientX: number, clientY: number) => ({
      x: Math.min(Math.max(clientX, screen.left), screen.left + screen.width),
      y: Math.min(Math.max(clientY, screen.top), screen.top + screen.height)
    }),
    [screen.height, screen.left, screen.top, screen.width]
  )

  const down = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const p = clampToImage(event.clientX, event.clientY)
      dragRef.current = p
      setRect({ x: p.x, y: p.y, w: 0, h: 0 })
    },
    [clampToImage]
  )
  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const p = clampToImage(event.clientX, event.clientY)
      const start = dragRef.current
      setRect({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y)
      })
    },
    [clampToImage]
  )
  const up = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }, [])

  const cancel = useCallback(() => setEditing(null), [setEditing])
  const apply = useCallback(() => {
    if (!image || !rect || rect.w < 4 || rect.h < 4) return
    const ratio = image.naturalWidth / Math.max(1, screen.width)
    const dataUrl = cropImage(image, {
      x: (rect.x - screen.left) * ratio,
      y: (rect.y - screen.top) * ratio,
      width: rect.w * ratio,
      height: rect.h * ratio
    })
    if (dataUrl) actions.addDerivedImage(node.id, dataUrl, { select: true })
    setEditing(null)
  }, [actions, image, node.id, rect, screen.left, screen.top, screen.width, setEditing])

  const canApply = !!rect && rect.w >= 4 && rect.h >= 4
  if (!node.data.src) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="pointer-events-auto absolute inset-0 bg-background/40" onClick={cancel} />
      {/* crop surface over the image */}
      <div
        className="pointer-events-auto absolute cursor-crosshair rounded-xl ring-2 ring-primary"
        style={{ left: screen.left, top: screen.top, width: screen.width, height: screen.height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <img
          src={node.data.src}
          alt=""
          className="pointer-events-none size-full rounded-xl object-fill opacity-60"
        />
        {rect && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/10"
            style={{
              left: rect.x - screen.left,
              top: rect.y - screen.top,
              width: rect.w,
              height: rect.h
            }}
          />
        )}
      </div>
      <motion.div
        className="pointer-events-auto absolute inset-x-0 bottom-4 z-40 flex justify-center px-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      >
        <div className="flex items-center gap-2 rounded-2xl border bg-background/90 p-2 pl-4 shadow-lg backdrop-blur-md">
          <span className="text-xs text-muted-foreground">
            {t('drawPage.cropHint', { defaultValue: 'Drag to select an area to crop' })}
          </span>
          <Button variant="outline" size="icon" className="size-9" onClick={cancel}>
            <X className="size-4" />
          </Button>
          <Button className="h-9 gap-1.5" onClick={apply} disabled={!canApply}>
            <Check className="size-4" />
            {t('drawPage.crop', { defaultValue: 'Crop' })}
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
