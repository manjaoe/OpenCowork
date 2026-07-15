import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import { Check } from 'lucide-react'
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
import type { CanvasNode, ImageNode } from './graph-types'

interface Props {
  node: ImageNode
}

export function NodeSplitDialog({ node }: Props): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const setEditing = useGraphStore((s) => s.setEditing)
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const updateNode = useGraphStore((s) => s.updateNode)
  const pushHistory = useGraphStore((s) => s.pushHistory)

  const group = useMemo(() => node.data.groupSrcs ?? [], [node.data.groupSrcs])
  const close = useCallback(() => setEditing(null), [setEditing])

  const setMain = useCallback(
    (item: { src: string; filePath?: string; mediaType?: string }) => {
      pushHistory()
      updateNode(node.id, (n) =>
        n.kind === 'image'
          ? {
              ...n,
              data: { ...n.data, src: item.src, filePath: item.filePath, mediaType: item.mediaType }
            }
          : n
      )
    },
    [node.id, pushHistory, updateNode]
  )

  const split = useCallback(() => {
    if (group.length === 0) return
    pushHistory()
    group.forEach((item, index) => {
      const child: CanvasNode = {
        id: nanoid(),
        kind: 'image',
        x: node.x + (node.w + 40) * ((index % 3) + 1),
        y: node.y + (node.h + 40) * Math.floor(index / 3),
        w: node.w,
        h: node.h,
        data: {
          src: item.src,
          filePath: item.filePath,
          mediaType: item.mediaType,
          prompt: node.data.prompt,
          providerId: node.data.providerId,
          modelId: node.data.modelId
        }
      }
      addNode(child, { history: false })
      addEdge(node.id, child.id, { history: false })
    })
    // the source node keeps its main image but drops the stacked-group badge
    updateNode(node.id, (n) =>
      n.kind === 'image' ? { ...n, data: { ...n.data, groupSrcs: undefined } } : n
    )
    setEditing(null)
  }, [addEdge, addNode, group, node, pushHistory, setEditing, updateNode])

  if (group.length === 0) return null

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('drawPage.splitGroup', { defaultValue: 'Image group' })}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {t('drawPage.splitHint', {
            defaultValue: 'Click an image to set it as the main one, or split all into nodes.'
          })}
        </p>

        <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
          {group.map((item, index) => {
            const isMain = item.src === node.data.src
            return (
              <button
                key={index}
                type="button"
                onClick={() => setMain(item)}
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-lg border-2 transition-colors',
                  isMain ? 'border-primary' : 'border-transparent hover:border-border'
                )}
              >
                <img src={item.src} alt="" className="size-full object-cover" />
                {isMain && (
                  <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('action.close', { ns: 'common', defaultValue: 'Close' })}
          </Button>
          <Button onClick={split}>
            {t('drawPage.splitAll', { defaultValue: 'Split into nodes' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
