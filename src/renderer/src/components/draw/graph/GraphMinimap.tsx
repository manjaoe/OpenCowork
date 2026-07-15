import { useMemo } from 'react'
import { screenToWorld } from './graph-geometry'
import { useGraphStore } from './graph-store'

const MM_W = 150
const MM_H = 104
const MM_PAD = 8

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function GraphMinimap(): React.JSX.Element | null {
  const nodes = useGraphStore((s) => s.nodes)
  const camera = useGraphStore((s) => s.camera)
  const stageSize = useGraphStore((s) => s.stageSize)

  const layout = useMemo(() => {
    if (nodes.length === 0 || stageSize.width === 0) return null
    const tl = screenToWorld({ x: 0, y: 0 }, camera)
    const viewport: Box = {
      x: tl.x,
      y: tl.y,
      w: stageSize.width / camera.scale,
      h: stageSize.height / camera.scale
    }
    const boxes: Box[] = [...nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })), viewport]
    const minX = Math.min(...boxes.map((b) => b.x))
    const minY = Math.min(...boxes.map((b) => b.y))
    const maxX = Math.max(...boxes.map((b) => b.x + b.w))
    const maxY = Math.max(...boxes.map((b) => b.y + b.h))
    const scale = Math.min(
      (MM_W - MM_PAD * 2) / (maxX - minX || 1),
      (MM_H - MM_PAD * 2) / (maxY - minY || 1)
    )
    const project = (b: Box): Box => ({
      x: MM_PAD + (b.x - minX) * scale,
      y: MM_PAD + (b.y - minY) * scale,
      w: b.w * scale,
      h: b.h * scale
    })
    return {
      nodes: nodes.map((n) => project({ x: n.x, y: n.y, w: n.w, h: n.h })),
      viewport: project(viewport)
    }
  }, [nodes, camera, stageSize])

  if (!layout) return null

  return (
    <div
      className="pointer-events-none absolute bottom-4 right-4 rounded-lg border border-border/60 bg-background/70 backdrop-blur-sm"
      style={{ width: MM_W, height: MM_H }}
      aria-hidden
    >
      {layout.nodes.map((n, index) => (
        <div
          key={index}
          className="absolute rounded-[2px] bg-muted-foreground/45"
          style={{ left: n.x, top: n.y, width: Math.max(2, n.w), height: Math.max(2, n.h) }}
        />
      ))}
      <div
        className="absolute rounded-[3px] border-[1.5px] border-primary"
        style={{
          left: layout.viewport.x,
          top: layout.viewport.y,
          width: layout.viewport.w,
          height: layout.viewport.h
        }}
      />
    </div>
  )
}
