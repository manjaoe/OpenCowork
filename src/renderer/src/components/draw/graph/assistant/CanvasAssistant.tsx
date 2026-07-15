import { useCallback, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { CornerDownLeft, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { runSidecarTextRequest } from '@renderer/lib/ipc/agent-bridge'
import type { ContentBlock, UnifiedMessage } from '@renderer/lib/api/types'
import { useProviderStore } from '@renderer/stores/provider-store'
import { cn } from '@renderer/lib/utils'
import { useGraphStore } from '../graph-store'
import { createCanvasNode } from '../node-factory'
import { useAssistantStore } from './assistant-store'
import type { CanvasNode, ImageNode, TextNode } from '../graph-types'

const SYSTEM_PROMPT =
  'You are a concise creative assistant on an infinite image canvas. The user may attach canvas nodes (text notes and images) as context. Help brainstorm, describe, critique, or write ready-to-use image-generation prompts. Answer directly without preamble.'

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

function imageContentBlock(node: ImageNode): ContentBlock | null {
  const src = node.data.src
  if (!src) return null
  const comma = src.indexOf(',')
  const data = comma >= 0 ? src.slice(comma + 1) : src
  return {
    type: 'image',
    source: { type: 'base64', mediaType: node.data.mediaType || 'image/png', data }
  }
}

export function CanvasAssistant(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const open = useAssistantStore((s) => s.open)
  const setOpen = useAssistantStore((s) => s.setOpen)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const contextCount = useGraphStore(
    (s) => s.selection.filter((id) => s.nodes.some((n) => n.id === id)).length
  )

  const send = useCallback(async () => {
    const request = input.trim()
    if (!request || busy) return
    const provider = useProviderStore.getState().getActiveProviderConfig()
    if (!provider) {
      toast.error(t('drawPage.assistantNoModel', { defaultValue: 'Select a chat model first' }))
      return
    }
    const { nodes, selection } = useGraphStore.getState()
    const selected = nodes.filter((n) => selection.includes(n.id))
    const contextText = selected
      .filter((n): n is TextNode => n.kind === 'text' && !!n.data.text.trim())
      .map((n) => n.data.text.trim())
      .join('\n\n')
    const imageBlocks = selected
      .filter((n): n is ImageNode => n.kind === 'image')
      .map(imageContentBlock)
      .filter((b): b is ContentBlock => b !== null)

    const userText = contextText
      ? `Context from canvas:\n${contextText}\n\n---\n${request}`
      : request
    const content: string | ContentBlock[] =
      imageBlocks.length > 0 ? [...imageBlocks, { type: 'text', text: userText }] : userText

    const priorMessages: UnifiedMessage[] = turns.map((turn) => ({
      id: nanoid(),
      role: turn.role,
      content: turn.text,
      createdAt: Date.now()
    }))
    const messages: UnifiedMessage[] = [
      ...priorMessages,
      { id: nanoid(), role: 'user', content, createdAt: Date.now() }
    ]

    setTurns((prev) => [...prev, { role: 'user', text: request }])
    setInput('')
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const output = await runSidecarTextRequest({
        messages,
        provider: { ...provider, systemPrompt: SYSTEM_PROMPT, temperature: 0.7, maxTokens: 1200 },
        signal: controller.signal
      })
      const text = output.trim()
      setTurns((prev) => [...prev, { role: 'assistant', text: text || '…' }])
    } catch (error) {
      toast.error(t('drawPage.assistantFailed', { defaultValue: 'Assistant request failed' }), {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [busy, input, t, turns])

  const insertAsNode = useCallback(
    (text: string) => {
      const { nodes, selection, addNode, addEdge } = useGraphStore.getState()
      const anchor = nodes.find((n) => selection.includes(n.id))
      const world = anchor ? { x: anchor.x + anchor.w + 320, y: anchor.y } : { x: 200, y: 200 }
      const base = createCanvasNode('text', world)
      const node: CanvasNode = { ...base, kind: 'text', data: { text } }
      addNode(node, { select: true })
      selection.forEach((id) => addEdge(id, node.id, { history: false }))
      toast.success(t('drawPage.assistantInserted', { defaultValue: 'Inserted as text node' }))
    },
    [t]
  )

  if (!open) return null

  return (
    <motion.div
      className="pointer-events-auto absolute right-4 top-16 z-40 flex max-h-[75%] w-80 flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-xl backdrop-blur-md"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold">
          {t('drawPage.assistant', { defaultValue: 'Canvas assistant' })}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t('drawPage.assistantContext', {
            count: contextCount,
            defaultValue: '{{count}} in context'
          })}
        </span>
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {turns.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t('drawPage.assistantHint', {
              defaultValue: 'Select nodes as context, then ask for ideas or a prompt.'
            })}
          </p>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs',
              turn.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-muted'
            )}
          >
            <p className="whitespace-pre-wrap break-words">{turn.text}</p>
            {turn.role === 'assistant' && (
              <button
                type="button"
                className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                onClick={() => insertAsNode(turn.text)}
              >
                <Plus className="size-3" />
                {t('drawPage.assistantInsert', { defaultValue: 'Insert as node' })}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('drawPage.assistantThinking', { defaultValue: 'Thinking…' })}
          </div>
        )}
      </div>

      <div className="border-t p-2">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={t('drawPage.assistantPlaceholder', { defaultValue: 'Ask the assistant…' })}
            className="max-h-28 min-h-9 resize-none pr-10 text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="absolute bottom-1.5 right-1.5 size-7"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
          >
            <CornerDownLeft className="size-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
