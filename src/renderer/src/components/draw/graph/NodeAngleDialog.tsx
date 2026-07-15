import { useCallback, useState } from 'react'
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Slider } from '@renderer/components/ui/slider'
import { cn } from '@renderer/lib/utils'
import { useGraphStore } from './graph-store'
import { useGraphActions } from './graph-actions'
import { useNodeImage } from './use-node-image'
import { transformImage } from './node-image-ops'
import type { ImageNode } from './graph-types'

interface Props {
  node: ImageNode
}

export function NodeAngleDialog({ node }: Props): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const setEditing = useGraphStore((s) => s.setEditing)
  const actions = useGraphActions()
  const image = useNodeImage(node.data.src)

  const [rotate, setRotate] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)

  const close = useCallback(() => setEditing(null), [setEditing])
  const step = useCallback(
    (delta: number) => setRotate((r) => (((r + delta) % 360) + 360) % 360),
    []
  )
  const apply = useCallback(() => {
    if (!image) return
    const dataUrl = transformImage(image, { rotate, flipH, flipV })
    if (dataUrl) actions.addDerivedImage(node.id, dataUrl, { select: true })
    setEditing(null)
  }, [actions, flipH, flipV, image, node.id, rotate, setEditing])

  if (!node.data.src) return null

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('drawPage.angleTransform', { defaultValue: 'Transform' })}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center rounded-lg border bg-muted/20 p-4">
          <img
            src={node.data.src}
            alt=""
            className="max-h-56 max-w-full object-contain transition-transform"
            style={{
              transform: `rotate(${rotate}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`
            }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => step(-90)}>
            <RotateCcw className="size-4" />
            90°
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => step(90)}>
            <RotateCw className="size-4" />
            90°
          </Button>
          <Button
            variant={flipH ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setFlipH((v) => !v)}
          >
            <FlipHorizontal className="size-4" />
            {t('drawPage.flipH', { defaultValue: 'Flip H' })}
          </Button>
          <Button
            variant={flipV ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setFlipV((v) => !v)}
          >
            <FlipVertical className="size-4" />
            {t('drawPage.flipV', { defaultValue: 'Flip V' })}
          </Button>
        </div>

        <div className="flex items-center gap-3 px-1">
          <span className="w-10 shrink-0 text-xs text-muted-foreground">
            {t('drawPage.angle', { defaultValue: 'Angle' })}
          </span>
          <Slider
            min={-180}
            max={180}
            step={1}
            value={[rotate > 180 ? rotate - 360 : rotate]}
            onValueChange={([v]) => typeof v === 'number' && setRotate(((v % 360) + 360) % 360)}
          />
          <span
            className={cn('w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground')}
          >
            {rotate > 180 ? rotate - 360 : rotate}°
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('action.cancel', { ns: 'common', defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={apply} disabled={!image}>
            {t('drawPage.generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
