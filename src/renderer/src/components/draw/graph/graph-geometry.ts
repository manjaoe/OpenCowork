import { GRAPH_MAX_SCALE, GRAPH_MIN_SCALE, type Camera } from './graph-store'
import type { CanvasNode, NodeBox } from './graph-types'

export interface Point {
  x: number
  y: number
}

export function clampScale(scale: number): number {
  return Math.min(GRAPH_MAX_SCALE, Math.max(GRAPH_MIN_SCALE, scale))
}

/** World → screen. The world container is transformed `translate(x,y) scale(s)`. */
export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y }
}

export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }
}

/** Zoom to `nextScale` keeping `screenPoint` anchored under the cursor. */
export function zoomAtPoint(camera: Camera, screenPoint: Point, nextScaleRaw: number): Camera {
  const nextScale = clampScale(nextScaleRaw)
  const world = screenToWorld(screenPoint, camera)
  return {
    scale: nextScale,
    x: screenPoint.x - world.x * nextScale,
    y: screenPoint.y - world.y * nextScale
  }
}

/** Left (input) and right (output) connection-point positions in world coords. */
export function inputPortWorld(node: NodeBox): Point {
  return { x: node.x, y: node.y + node.h / 2 }
}
export function outputPortWorld(node: NodeBox): Point {
  return { x: node.x + node.w, y: node.y + node.h / 2 }
}

/** Center a viewport on the graph's content bounds. */
export function fitCamera(
  nodes: CanvasNode[],
  stage: { width: number; height: number },
  padding = 80
): Camera {
  if (nodes.length === 0 || stage.width === 0) return { scale: 1, x: 0, y: 0 }
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const scale = clampScale(
    Math.min((stage.width - padding * 2) / w, (stage.height - padding * 2) / h, 1)
  )
  return {
    scale,
    x: stage.width / 2 - (minX + w / 2) * scale,
    y: stage.height / 2 - (minY + h / 2) * scale
  }
}

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export function nodeScreenRect(node: NodeBox, camera: Camera): ScreenRect {
  const topLeft = worldToScreen({ x: node.x, y: node.y }, camera)
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: node.w * camera.scale,
    height: node.h * camera.scale
  }
}

/** Cubic bezier path (SVG `d`) between two world points, for edges. */
export function edgePath(from: Point, to: Point): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}
