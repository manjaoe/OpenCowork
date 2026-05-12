import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ClipboardCopy,
  Eraser,
  ExternalLink,
  ImageDown,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Target,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@renderer/components/ui/button'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { MessageList } from '@renderer/components/chat/MessageList'
import { ImageEditDialog } from '@renderer/components/chat/ImageEditDialog'
import { InputArea } from '@renderer/components/chat/InputArea'
import { ProjectTerminalDock } from '@renderer/components/terminal/ProjectTerminalDock'
import { WorkingFolderSelectorDialog } from '@renderer/components/chat/WorkingFolderSelectorDialog'
import {
  abortSession,
  clearPendingSessionMessages,
  useChatActions
} from '@renderer/hooks/use-chat-actions'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { openDetachedSessionWindow } from '@renderer/lib/session-window'
import { sessionToMarkdown } from '@renderer/lib/utils/export-chat'
import { cn } from '@renderer/lib/utils'
import { dataUrlToBlob, writeImageBlobToClipboard } from '@renderer/lib/utils/image-clipboard'
import { useChatStore } from '@renderer/stores/chat-store'
import { useGoalStore } from '@renderer/stores/goal-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { toast } from 'sonner'
import {
  formatGoalElapsedSeconds,
  formatGoalTokens,
  goalStatusLabel,
  validateGoalObjective
} from '@renderer/lib/agent/goal-context'

interface SessionConversationPaneProps {
  sessionId?: string | null
  allowOpenInNewWindow?: boolean
  windowHeaderOwnsTitle?: boolean
}

const EXPORT_IMAGE_PLACEHOLDER_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='
const TERMINAL_DOCK_TRANSITION = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1] as const
}

function isRemoteImageSrc(value: string | null): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

async function waitForExportImageReady(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      image.removeEventListener('load', handleDone)
      image.removeEventListener('error', handleDone)
    }

    const handleDone = (): void => {
      cleanup()
      resolve()
    }

    image.addEventListener('load', handleDone, { once: true })
    image.addEventListener('error', handleDone, { once: true })
  })
}

async function inlineRemoteImagesForExport(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (images.length === 0) return

  const dataUrlCache = new Map<string, string>()

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src')?.trim() || ''
      if (!src) return

      image.removeAttribute('srcset')

      if (!isRemoteImageSrc(src)) {
        await waitForExportImageReady(image)
        return
      }

      let dataUrl = dataUrlCache.get(src)
      if (!dataUrl) {
        try {
          const result = (await window.api.fetchImageBase64({ url: src })) as {
            data?: string
            mimeType?: string
            error?: string
          }
          if (result.error) throw new Error(result.error)
          dataUrl = result.data
            ? `data:${result.mimeType || 'image/png'};base64,${result.data}`
            : EXPORT_IMAGE_PLACEHOLDER_DATA_URL
        } catch {
          dataUrl = EXPORT_IMAGE_PLACEHOLDER_DATA_URL
        }
        dataUrlCache.set(src, dataUrl)
      }

      image.setAttribute('src', dataUrl)
      await waitForExportImageReady(image)
    })
  )
}

export function SessionConversationPane({
  sessionId,
  allowOpenInNewWindow = true,
  windowHeaderOwnsTitle = false
}: SessionConversationPaneProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const renameSessionLabel = t('sidebar.renameSession', { defaultValue: 'Rename session' }).replace(
    /[:：]\s*$/,
    ''
  )
  const clearConversationLabel = t('layout.clearConversation', {
    defaultValue: 'Clear conversation'
  })
  const resolvedSessionId = useChatStore((state) => sessionId ?? state.activeSessionId)
  const sessionView = useChatStore(
    useShallow((state) => {
      const targetSessionId = sessionId ?? state.activeSessionId
      const currentSession = targetSessionId
        ? state.sessions.find((item) => item.id === targetSessionId)
        : undefined
      const currentProject = currentSession?.projectId
        ? state.projects.find((item) => item.id === currentSession.projectId)
        : undefined

      return {
        sessionId: targetSessionId,
        title: currentSession?.title ?? null,
        projectId: currentSession?.projectId ?? null,
        projectName: currentProject?.name ?? null,
        workingFolder: currentSession?.workingFolder ?? currentProject?.workingFolder,
        sshConnectionId: currentSession?.sshConnectionId ?? currentProject?.sshConnectionId ?? null,
        messageCount: currentSession?.messageCount ?? 0
      }
    })
  )
  const streamingMessageId = useChatStore((state) =>
    resolvedSessionId ? (state.streamingMessages[resolvedSessionId] ?? null) : null
  )
  const goal = useGoalStore((state) =>
    resolvedSessionId ? state.goalsBySession[resolvedSessionId] : undefined
  )
  const terminalDockOpen = useUIStore((state) =>
    sessionView.projectId
      ? Boolean(state.bottomTerminalDockOpenByProjectId[sessionView.projectId])
      : false
  )
  const animationsEnabled = useSettingsStore((state) => state.animationsEnabled)
  const isStreaming = Boolean(streamingMessageId)
  const {
    sendMessage,
    stopStreaming,
    continueLastToolExecution,
    retryLastMessage,
    editAndResend,
    deleteMessage,
    manualCompressContext
  } = useChatActions()
  const updateSessionTitle = useChatStore((state) => state.updateSessionTitle)
  const clearSessionMessages = useChatStore((state) => state.clearSessionMessages)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const [copiedAll, setCopiedAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportRendering, setExportRendering] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [goalDialogOpen, setGoalDialogOpen] = useState(false)
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('')
  const [goalTokenBudgetDraft, setGoalTokenBudgetDraft] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalClearing, setGoalClearing] = useState(false)

  const compactSessionHeader = sessionView.messageCount === 0
  const hasProjectFolderAction = Boolean(sessionView.projectId && sessionView.workingFolder)
  const hasTranscriptActions = sessionView.messageCount > 0
  const showSessionActionBar =
    hasProjectFolderAction || hasTranscriptActions || allowOpenInNewWindow
  const showTerminalDock = Boolean(
    sessionView.projectId &&
    terminalDockOpen &&
    (sessionView.workingFolder || sessionView.sshConnectionId)
  )

  const updateSessionProjectDirectory = useCallback(
    async (patch: Partial<{ workingFolder: string | null; sshConnectionId: string | null }>) => {
      const projectId = sessionView.projectId
      if (!projectId) return
      useChatStore.getState().updateProjectDirectory(projectId, patch)
    },
    [sessionView.projectId]
  )

  const handleOpenWorkingFolder = useCallback(async (): Promise<void> => {
    if (!sessionView.workingFolder) return
    await ipcClient.invoke(IPC.SHELL_OPEN_PATH, sessionView.workingFolder)
  }, [sessionView.workingFolder])

  const handleCopyAll = useCallback((): void => {
    if (!resolvedSessionId) return
    const session = useChatStore.getState().sessions.find((item) => item.id === resolvedSessionId)
    if (!session) return
    navigator.clipboard.writeText(sessionToMarkdown(session))
    setCopiedAll(true)
    window.setTimeout(() => setCopiedAll(false), 2000)
  }, [resolvedSessionId])

  const handleExportImage = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId) return
    const session = useChatStore.getState().sessions.find((item) => item.id === resolvedSessionId)
    if (!session) return

    setExporting(true)

    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-export-image', '')
    styleEl.textContent = `
      [data-message-content] * {
        max-width: 100% !important;
        overflow-wrap: break-word !important;
        word-break: break-word !important;
      }
      [data-message-content] pre,
      [data-message-content] code {
        white-space: pre-wrap !important;
        word-break: break-all !important;
      }
      [data-message-content] table {
        table-layout: fixed !important;
        width: 100% !important;
      }
      [data-message-content] img,
      [data-message-content] svg {
        max-width: 100% !important;
        height: auto !important;
      }
    `
    document.head.appendChild(styleEl)

    try {
      await useChatStore.getState().loadSessionMessages(resolvedSessionId, true)
      setExportRendering(true)

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })

      const node = document.querySelector('[data-message-content]') as HTMLElement | null
      if (!node) {
        throw new Error('Export target not found')
      }

      const exportStage = document.createElement('div')
      exportStage.setAttribute('data-export-image-stage', '')
      exportStage.style.cssText = [
        'position: fixed',
        'left: -100000px',
        'top: 0',
        'opacity: 0',
        'pointer-events: none',
        `width: ${node.clientWidth}px`
      ].join(';')

      const exportNode = node.cloneNode(true) as HTMLElement
      exportStage.appendChild(exportNode)
      document.body.appendChild(exportStage)

      try {
        await inlineRemoteImagesForExport(exportNode)
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })

        const bgRaw = getComputedStyle(document.documentElement)
          .getPropertyValue('--background')
          .trim()
        const bgColor = bgRaw ? `hsl(${bgRaw})` : '#ffffff'
        const { toPng } = await import('html-to-image')
        const captureWidth = node.clientWidth
        const captureHeight = Math.max(
          exportNode.scrollHeight,
          exportNode.offsetHeight,
          node.scrollHeight,
          node.offsetHeight
        )
        const dataUrl = await toPng(exportNode, {
          backgroundColor: bgColor,
          pixelRatio: 2,
          width: captureWidth,
          height: captureHeight,
          canvasWidth: captureWidth * 2,
          canvasHeight: captureHeight * 2,
          style: {
            overflow: 'visible',
            maxWidth: `${captureWidth}px`,
            width: `${captureWidth}px`,
            height: `${captureHeight}px`
          }
        })

        await writeImageBlobToClipboard(dataUrlToBlob(dataUrl))
      } finally {
        exportStage.remove()
      }
      toast.success(t('layout.imageCopied', { defaultValue: 'Image copied to clipboard' }))
    } catch (error) {
      console.error('Export image failed:', error)
      toast.error(t('layout.exportImageFailed', { defaultValue: 'Export image failed' }), {
        description: String(error)
      })
    } finally {
      setExportRendering(false)
      document.head.removeChild(styleEl)
      setExporting(false)
    }
  }, [resolvedSessionId, t])

  const handleOpenInWindow = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId) return
    await openDetachedSessionWindow(resolvedSessionId)
  }, [resolvedSessionId])

  const handleOpenRenameDialog = useCallback((): void => {
    const nextTitle = sessionView.title?.trim()
    setRenameValue(nextTitle || '')
    setRenameDialogOpen(true)
  }, [sessionView.title])

  const handleRenameSession = useCallback((): void => {
    if (!resolvedSessionId) return
    const nextTitle = renameValue.trim()
    if (!nextTitle) return
    updateSessionTitle(resolvedSessionId, nextTitle)
    setRenameDialogOpen(false)
  }, [renameValue, resolvedSessionId, updateSessionTitle])

  const openGoalDialog = useCallback((): void => {
    setGoalObjectiveDraft(goal?.objective ?? '')
    setGoalTokenBudgetDraft(
      goal?.tokenBudget !== undefined && goal.tokenBudget !== null ? String(goal.tokenBudget) : ''
    )
    setGoalDialogOpen(true)
  }, [goal?.objective, goal?.tokenBudget])

  const parseGoalTokenBudget = useCallback((): { tokenBudget: number | null; error?: string } => {
    const raw = goalTokenBudgetDraft.trim()
    if (!raw) return { tokenBudget: null }
    if (!/^\d+$/.test(raw)) {
      return { tokenBudget: null, error: 'Token budget must be a positive integer.' }
    }
    const tokenBudget = Number(raw)
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
      return { tokenBudget: null, error: 'Token budget must be a positive integer.' }
    }
    return { tokenBudget }
  }, [goalTokenBudgetDraft])

  const handleGoalStatus = useCallback(
    async (status: 'active' | 'paused'): Promise<void> => {
      if (!resolvedSessionId) return
      const result = await useGoalStore.getState().updateGoal(resolvedSessionId, { status })
      if (!result.success) {
        toast.error('Goal update failed', { description: result.error })
        return
      }
      if (status === 'active' && result.goal?.status === 'budget_limited') {
        toast.info('Goal budget is still exhausted', {
          description: 'Increase the token budget before resuming.'
        })
        return
      }
      if (status === 'active' && result.goal?.status === 'active') {
        queueMicrotask(() => {
          void sendMessage('', undefined, 'continue', resolvedSessionId, null)
        })
      }
    },
    [resolvedSessionId, sendMessage]
  )

  const handleGoalClear = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId || !goal) return
    const confirmed = await confirm({
      title: 'Clear this goal?',
      variant: 'destructive'
    })
    if (!confirmed) return
    setGoalClearing(true)
    const result = await useGoalStore.getState().clearGoal(resolvedSessionId)
    setGoalClearing(false)
    if (!result.success) {
      toast.error('Goal clear failed', { description: result.error })
      return
    }
    setGoalDialogOpen(false)
    setGoalObjectiveDraft('')
    setGoalTokenBudgetDraft('')
  }, [goal, resolvedSessionId])

  const handleGoalSave = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId) return
    const objective = goalObjectiveDraft.trim()
    const validation = validateGoalObjective(objective)
    if (validation) {
      toast.error('Goal objective invalid', { description: validation })
      return
    }
    const budget = parseGoalTokenBudget()
    if (budget.error) {
      toast.error('Goal budget invalid', { description: budget.error })
      return
    }

    setGoalSaving(true)
    const result = goal
      ? await useGoalStore.getState().updateGoal(resolvedSessionId, {
          objective,
          tokenBudget: budget.tokenBudget
        })
      : await useGoalStore.getState().setGoal({
          sessionId: resolvedSessionId,
          objective,
          tokenBudget: budget.tokenBudget
        })
    setGoalSaving(false)
    if (!result.success) {
      toast.error(goal ? 'Goal update failed' : 'Goal creation failed', {
        description: result.error
      })
      return
    }
    setGoalDialogOpen(false)
    if (result.goal?.status === 'active') {
      queueMicrotask(() => {
        void sendMessage('', undefined, 'continue', resolvedSessionId, null)
      })
    }
  }, [goal, goalObjectiveDraft, parseGoalTokenBudget, resolvedSessionId, sendMessage])

  const handleClearConversation = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId || sessionView.messageCount === 0) return
    const confirmed = await confirm({
      title: t('layout.clearConfirm', { count: sessionView.messageCount }),
      variant: 'destructive'
    })
    if (!confirmed) return
    clearSessionMessages(resolvedSessionId)
    toast.success(t('layout.conversationCleared'))
  }, [clearSessionMessages, resolvedSessionId, sessionView.messageCount, t])

  const handleDeleteSession = useCallback(async (): Promise<void> => {
    if (!resolvedSessionId) return
    const confirmed = await confirm({
      title: t('layout.deleteConfirm', {
        title: sessionView.title ?? t('sidebar.newChat', { defaultValue: 'New chat' })
      }),
      variant: 'destructive'
    })
    if (!confirmed) return
    abortSession(resolvedSessionId)
    clearPendingSessionMessages(resolvedSessionId)
    deleteSession(resolvedSessionId)
  }, [deleteSession, resolvedSessionId, sessionView.title, t])

  const conversationRoot = useMemo(() => resolvedSessionId ?? 'empty', [resolvedSessionId])
  const showInlineSessionTitle = !windowHeaderOwnsTitle

  if (!resolvedSessionId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('sidebar.newChat', { defaultValue: 'New chat' })}
      </div>
    )
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-background">
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 px-4 pt-3',
          showInlineSessionTitle ? (compactSessionHeader ? 'pb-1' : 'pb-2') : 'pb-2 pt-2'
        )}
      >
        <div className="min-w-0 flex-1">
          {showInlineSessionTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={cn(
                  'min-w-0 flex-1 truncate text-foreground',
                  compactSessionHeader ? 'text-[13px] font-medium' : 'text-[14px] font-medium'
                )}
              >
                {sessionView.title ?? t('sidebar.newChat', { defaultValue: 'New chat' })}
              </div>
              {sessionView.projectId ? (
                <div className="flex min-w-0 max-w-[38%] shrink items-center gap-1.5 text-[11px] text-muted-foreground/65">
                  <span className="shrink-0 text-muted-foreground/35">/</span>
                  {sessionView.workingFolder ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate cursor-default">
                          {sessionView.projectName ??
                            t('sidebar.projects', { defaultValue: 'Project' })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{sessionView.workingFolder}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="truncate">
                      {sessionView.projectName ??
                        t('sidebar.projects', { defaultValue: 'Project' })}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {showSessionActionBar ? (
            <div className="flex items-center rounded-lg border border-border/60 bg-background/70 p-0.5 shadow-sm backdrop-blur-sm">
              {hasProjectFolderAction ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 rounded-md text-muted-foreground/80 hover:text-foreground"
                      onClick={() => void handleOpenWorkingFolder()}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('layout.openFolder', { defaultValue: 'Open folder' })}
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {hasProjectFolderAction && hasTranscriptActions ? (
                <div className="mx-0.5 h-4 w-px bg-border/60" />
              ) : null}

              {hasTranscriptActions ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md text-muted-foreground/80 hover:text-foreground"
                        onClick={handleCopyAll}
                        disabled={isStreaming}
                      >
                        {copiedAll ? (
                          <Check className="size-4 text-foreground" />
                        ) : (
                          <ClipboardCopy className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('layout.copyAll', { defaultValue: 'Copy conversation' })}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md text-muted-foreground/80 hover:text-foreground"
                        onClick={() => void handleExportImage()}
                        disabled={exporting || isStreaming}
                      >
                        {exporting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ImageDown className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('layout.exportImage', { defaultValue: 'Copy as image' })}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md text-muted-foreground/80 hover:text-foreground"
                        onClick={() => void handleClearConversation()}
                        disabled={isStreaming}
                      >
                        <Eraser className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{clearConversationLabel}</TooltipContent>
                  </Tooltip>
                </>
              ) : null}

              <div className="mx-0.5 h-4 w-px bg-border/60" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md text-muted-foreground/80 hover:text-foreground"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {hasProjectFolderAction ? (
                    <DropdownMenuItem onClick={() => void handleOpenWorkingFolder()}>
                      <ExternalLink className="size-4" />
                      {t('layout.openFolder', { defaultValue: 'Open folder' })}
                    </DropdownMenuItem>
                  ) : null}
                  {allowOpenInNewWindow ? (
                    <DropdownMenuItem onClick={() => void handleOpenInWindow()}>
                      <ExternalLink className="size-4" />
                      {t('sidebar.openInNewWindow', { defaultValue: 'Open in new window' })}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={handleOpenRenameDialog}>
                    <Pencil className="size-4" />
                    {renameSessionLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleCopyAll}
                    disabled={isStreaming || !hasTranscriptActions}
                  >
                    {copiedAll ? (
                      <Check className="size-4" />
                    ) : (
                      <ClipboardCopy className="size-4" />
                    )}
                    {t('layout.copyAll', { defaultValue: 'Copy conversation' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleExportImage()}
                    disabled={exporting || isStreaming || !hasTranscriptActions}
                  >
                    {exporting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImageDown className="size-4" />
                    )}
                    {t('layout.exportImage', { defaultValue: 'Copy as image' })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleClearConversation()}
                    disabled={sessionView.messageCount === 0}
                  >
                    <Eraser className="size-4" />
                    {clearConversationLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void handleDeleteSession()}
                  >
                    <Trash2 className="size-4" />
                    {t('layout.deleteConversation', { defaultValue: 'Delete conversation' })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </div>

      <div key={conversationRoot} className="flex min-h-0 flex-1 flex-col">
        <MessageList
          sessionId={resolvedSessionId}
          onRetry={retryLastMessage}
          onContinue={continueLastToolExecution}
          onEditUserMessage={editAndResend}
          onDeleteMessage={deleteMessage}
          exportAll={exportRendering}
        />
        {resolvedSessionId ? (
          <div className="mx-auto w-full max-w-[860px] px-4 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/85 px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
              <Target className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Goal</span>
                  <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {goal ? goalStatusLabel(goal.status) : 'not set'}
                  </span>
                  {goal ? (
                    <>
                      <span className="text-muted-foreground">
                        {formatGoalElapsedSeconds(goal.timeUsedSeconds)}
                      </span>
                      <span className="text-muted-foreground">
                        {goal.tokenBudget !== undefined && goal.tokenBudget !== null
                          ? `${formatGoalTokens(goal.tokensUsed)} / ${formatGoalTokens(goal.tokenBudget)}`
                          : `${formatGoalTokens(goal.tokensUsed)} tokens`}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {goal ? goal.objective : 'Set a long-running session goal for this chat.'}
                </div>
              </div>
              {goal?.status === 'active' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title="Pause goal"
                  onClick={() => void handleGoalStatus('paused')}
                >
                  <Pause className="size-3.5" />
                </Button>
              ) : goal && goal.status !== 'complete' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  title="Resume goal"
                  onClick={() => void handleGoalStatus('active')}
                >
                  <Play className="size-3.5" />
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2"
                onClick={openGoalDialog}
              >
                {goal ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
                {goal ? 'Manage' : 'Set'}
              </Button>
            </div>
          </div>
        ) : null}
        <InputArea
          sessionId={resolvedSessionId}
          onSend={(text, images, options) =>
            void sendMessage(text, images, undefined, resolvedSessionId, undefined, undefined, {
              ...options,
              clearCompletedTasksOnTurnStart: true
            })
          }
          onStop={stopStreaming}
          onSelectFolder={sessionView.projectId ? () => setFolderDialogOpen(true) : undefined}
          workingFolder={sessionView.workingFolder}
          hideWorkingFolderIndicator
          onCompressContext={manualCompressContext}
          isStreaming={isStreaming}
        />
        {animationsEnabled ? (
          <AnimatePresence initial={false}>
            {showTerminalDock ? (
              <motion.div
                key={`terminal-dock-${sessionView.projectId}`}
                initial={{ height: 0, opacity: 0, y: 12 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: 12 }}
                transition={{
                  height: TERMINAL_DOCK_TRANSITION,
                  y: TERMINAL_DOCK_TRANSITION,
                  opacity: { duration: 0.16, ease: 'easeOut' }
                }}
                className="min-h-0 overflow-hidden"
                style={{ willChange: 'height, opacity, transform' }}
              >
                <ProjectTerminalDock
                  projectId={sessionView.projectId!}
                  projectName={sessionView.projectName}
                  workingFolder={sessionView.workingFolder ?? null}
                  sshConnectionId={sessionView.sshConnectionId}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        ) : showTerminalDock ? (
          <ProjectTerminalDock
            projectId={sessionView.projectId!}
            projectName={sessionView.projectName}
            workingFolder={sessionView.workingFolder ?? null}
            sshConnectionId={sessionView.sshConnectionId}
          />
        ) : null}
      </div>

      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Goal Manager</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-md border border-border/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Status
                </div>
                <div className="mt-1 text-sm font-medium">
                  {goal ? goalStatusLabel(goal.status) : 'not set'}
                </div>
              </div>
              <div className="rounded-md border border-border/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Tokens
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatGoalTokens(goal?.tokensUsed ?? 0)}
                </div>
              </div>
              <div className="rounded-md border border-border/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Budget
                </div>
                <div className="mt-1 text-sm font-medium">
                  {goal?.tokenBudget !== undefined && goal.tokenBudget !== null
                    ? formatGoalTokens(goal.tokenBudget)
                    : 'none'}
                </div>
              </div>
              <div className="rounded-md border border-border/70 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Time
                </div>
                <div className="mt-1 text-sm font-medium">
                  {formatGoalElapsedSeconds(goal?.timeUsedSeconds ?? 0)}
                </div>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Objective</span>
              <Textarea
                className="min-h-32 resize-y text-sm"
                value={goalObjectiveDraft}
                onChange={(event) => setGoalObjectiveDraft(event.target.value)}
                placeholder="Finish the current project goal..."
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Token budget</span>
              <Input
                inputMode="numeric"
                value={goalTokenBudgetDraft}
                onChange={(event) => setGoalTokenBudgetDraft(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
            <div className="flex items-center gap-1">
              {goal?.status === 'active' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => void handleGoalStatus('paused')}
                >
                  <Pause className="size-3.5" />
                  Pause
                </Button>
              ) : goal ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => void handleGoalStatus('active')}
                >
                  <Play className="size-3.5" />
                  {goal.status === 'complete' ? 'Start' : 'Resume'}
                </Button>
              ) : null}
              {goal && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive"
                  disabled={goalClearing}
                  onClick={() => void handleGoalClear()}
                >
                  <Trash2 className="size-3.5" />
                  Clear
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setGoalDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5"
                disabled={goalSaving}
                onClick={() => void handleGoalSave()}
              >
                <Save className="size-3.5" />
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{renameSessionLabel}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleRenameSession()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              {t('action.cancel', { ns: 'common' })}
            </Button>
            <Button onClick={handleRenameSession} disabled={!renameValue.trim()}>
              {t('action.save', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sessionView.projectId ? (
        <WorkingFolderSelectorDialog
          open={folderDialogOpen}
          onOpenChange={setFolderDialogOpen}
          workingFolder={sessionView.workingFolder}
          sshConnectionId={sessionView.sshConnectionId}
          onSelectLocalFolder={(folderPath) =>
            updateSessionProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: null
            })
          }
          onSelectSshFolder={(folderPath, connectionId) =>
            updateSessionProjectDirectory({
              workingFolder: folderPath,
              sshConnectionId: connectionId
            })
          }
        />
      ) : null}
      <ImageEditDialog sessionId={resolvedSessionId} />
    </div>
  )
}
