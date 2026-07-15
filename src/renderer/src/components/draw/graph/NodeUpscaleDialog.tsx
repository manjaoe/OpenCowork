import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useGraphStore } from './graph-store'
import { useGraphActions } from './graph-actions'
import { useNodeImage } from './use-node-image'
import { upscaleImageLocal } from './node-image-ops'
import type { ImageNode } from './graph-types'

interface Props {
  node: ImageNode
}

const FACTORS = [2, 4]

export function NodeUpscaleDialog({ node }: Props): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const setEditing = useGraphStore((s) => s.setEditing)
  const actions = useGraphActions()
  const image = useNodeImage(node.data.src)
  const [factor, setFactor] = useState(2)

  const close = useCallback(() => setEditing(null), [setEditing])
  const apply = useCallback(() => {
    if (!image) return
    const dataUrl = upscaleImageLocal(image, factor)
    if (dataUrl) actions.addDerivedImage(node.id, dataUrl, { select: true })
    setEditing(null)
  }, [actions, factor, image, node.id, setEditing])

  if (!node.data.src) return null
  const w = image?.naturalWidth ?? 0
  const h = image?.naturalHeight ?? 0

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('drawPage.upscale', { defaultValue: 'Upscale' })}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {FACTORS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFactor(f)}
              className={cn(
                'flex-1 rounded-lg border py-2 text-sm font-medium transition-colors',
                factor === f
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {f}×
            </button>
          ))}
        </div>

        {w > 0 && (
          <p className="text-center text-xs text-muted-foreground tabular-nums">
            {w} × {h} → {w * factor} × {h * factor}
          </p>
        )}

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
