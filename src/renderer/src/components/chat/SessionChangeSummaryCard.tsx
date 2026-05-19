import * as React from 'react'
import { ChevronDown, ChevronUp, FileCode, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MONO_FONT } from '@renderer/lib/constants'
import {
  useAgentStore,
  type AgentRunChangeSet,
  type AgentRunFileChange
} from '@renderer/stores/agent-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { ToolUseBlock, UnifiedMessage } from '@renderer/lib/api/types'
import { decodeStructuredToolResult } from '@renderer/lib/tools/tool-result-format'
import { useAggregatedChangeSummaries } from './change-summary-utils'
import {
  actionableSourceChanges,
  aggregateDisplayableRunFileChanges,
  lineCount,
  type AggregatedFileChange
} from './file-change-utils'

interface SessionChangeSummaryCardProps {
  sessionId?: string | null
  assistantMessageIds?: readonly string[]
  messages?: readonly UnifiedMessage[]
  toolUseIds?: readonly string[]
}

const DEFAULT_EXPANDED_FILE_LIMIT = 4
const SYNTHETIC_CHANGE_PREFIX = 'message-tool-change:'

function changeSetMatchesSession(
  changeSet: AgentRunChangeSet,
  sessionId: string | null | undefined,
  assistantMessageIds: Set<string>,
  toolUseIds: Set<string>
): boolean {
  return (
    (!!sessionId &&
      (changeSet.sessionId === sessionId ||
        changeSet.changes.some((change) => change.sessionId === sessionId))) ||
    assistantMessageIds.has(changeSet.assistantMessageId) ||
    assistantMessageIds.has(changeSet.runId) ||
    changeSet.changes.some((change) => change.toolUseId && toolUseIds.has(change.toolUseId))
  )
}

function useSessionChangeSets({
  sessionId,
  assistantMessageIds = [],
  toolUseIds = []
}: SessionChangeSummaryCardProps): AgentRunChangeSet[] {
  const runChangesByRunId = useAgentStore((state) => state.runChangesByRunId)

  return React.useMemo(() => {
    const assistantMessageIdSet = new Set(assistantMessageIds)
    const toolUseIdSet = new Set(toolUseIds)
    const seen = new Set<string>()

    return Object.values(runChangesByRunId)
      .filter((changeSet) => {
        if (seen.has(changeSet.runId)) return false
        seen.add(changeSet.runId)
        return changeSetMatchesSession(changeSet, sessionId, assistantMessageIdSet, toolUseIdSet)
      })
      .sort((left, right) => left.createdAt - right.createdAt)
  }, [assistantMessageIds, runChangesByRunId, sessionId, toolUseIds])
}

function getMessageToolResultMap(
  messages: readonly UnifiedMessage[]
): Map<string, { isError?: boolean; content?: unknown }> {
  const results = new Map<string, { isError?: boolean; content?: unknown }>()
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue
      results.set(block.toolUseId, {
        isError: block.isError,
        content: block.content
      })
    }
  }
  return results
}

function getToolFilePath(block: ToolUseBlock): string {
  const value = block.input.file_path ?? block.input.path
  return typeof value === 'string' ? value.trim() : ''
}

function parseToolResult(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') return null
  const parsed = decodeStructuredToolResult(content)
  return parsed && !Array.isArray(parsed) ? parsed : null
}

function buildSnapshot(text: string, exists = true): AgentRunFileChange['after'] {
  const size = new TextEncoder().encode(text).length
  return {
    exists,
    text,
    hash: null,
    size,
    lineCount: lineCount(text)
  }
}

function buildSyntheticMessageToolChanges(
  messages: readonly UnifiedMessage[],
  sessionId: string
): AgentRunFileChange[] {
  const resultsByToolUseId = getMessageToolResultMap(messages)
  const changes: AgentRunFileChange[] = []

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue

    for (const block of message.content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue
      if (block.name !== 'Edit' && block.name !== 'Write') continue

      const filePath = getToolFilePath(block)
      if (!filePath) continue

      const result = resultsByToolUseId.get(block.id)
      const parsedResult = parseToolResult(result?.content)
      if (result?.isError || typeof parsedResult?.error === 'string') continue

      const createdAt = message.createdAt ?? Date.now()
      const id = `${SYNTHETIC_CHANGE_PREFIX}${message.id}:${block.id}`
      const baseChange = {
        id,
        runId: id,
        sessionId,
        toolUseId: block.id,
        toolName: block.name,
        filePath,
        transport: 'local' as const,
        status: 'accepted' as const,
        createdAt
      }

      if (block.name === 'Edit') {
        const beforeText =
          typeof block.input.old_string === 'string'
            ? block.input.old_string
            : typeof block.input.old_string_preview === 'string'
              ? block.input.old_string_preview
              : ''
        const afterText =
          typeof block.input.new_string === 'string'
            ? block.input.new_string
            : typeof block.input.new_string_preview === 'string'
              ? block.input.new_string_preview
              : ''

        if (!beforeText && !afterText) continue

        changes.push({
          ...baseChange,
          op: 'modify',
          before: buildSnapshot(beforeText),
          after: buildSnapshot(afterText)
        })
        continue
      }

      const afterText =
        typeof block.input.content === 'string'
          ? block.input.content
          : typeof block.input.content_preview === 'string'
            ? block.input.content_preview
            : ''
      const op = parsedResult?.op === 'modify' ? 'modify' : 'create'
      changes.push({
        ...baseChange,
        op,
        before: buildSnapshot('', op === 'modify'),
        after: buildSnapshot(afterText)
      })
    }
  }

  return changes
}

function changeGroupKey(
  change: Pick<AggregatedFileChange, 'filePath' | 'transport' | 'connectionId'>
): string {
  return [change.transport, change.connectionId ?? '', change.filePath].join('\u0000')
}

export function SessionChangeSummaryCard({
  sessionId,
  assistantMessageIds = [],
  messages = [],
  toolUseIds = []
}: SessionChangeSummaryCardProps): React.JSX.Element | null {
  const { t } = useTranslation(['chat', 'common'])
  const refreshSessionRunChanges = useAgentStore((state) => state.refreshSessionRunChanges)
  const rollbackFileChange = useAgentStore((state) => state.rollbackFileChange)
  const openDetailPanel = useUIStore((state) => state.openDetailPanel)
  const changeSets = useSessionChangeSets({ sessionId, assistantMessageIds, toolUseIds })
  const [isRollingBack, setIsRollingBack] = React.useState(false)

  React.useEffect(() => {
    if (!sessionId) return
    void refreshSessionRunChanges(sessionId, {
      ...(assistantMessageIds.length > 0 ? { assistantMessageIds: [...assistantMessageIds] } : {}),
      ...(toolUseIds.length > 0 ? { toolUseIds: [...toolUseIds] } : {})
    })
  }, [assistantMessageIds, refreshSessionRunChanges, sessionId, toolUseIds])

  const aggregatedChanges = React.useMemo(() => {
    const trackedChanges = aggregateDisplayableRunFileChanges(
      changeSets.flatMap((changeSet) => changeSet.changes)
    )
    const trackedKeys = new Set(trackedChanges.map(changeGroupKey))
    const syntheticChanges = sessionId
      ? aggregateDisplayableRunFileChanges(buildSyntheticMessageToolChanges(messages, sessionId))
      : []

    return [
      ...trackedChanges,
      ...syntheticChanges.filter((change) => !trackedKeys.has(changeGroupKey(change)))
    ].sort((left, right) => left.createdAt - right.createdAt)
  }, [changeSets, messages, sessionId])
  const summariesByChangeId = useAggregatedChangeSummaries(aggregatedChanges)
  const summary = React.useMemo(
    () =>
      aggregatedChanges.reduce(
        (acc, change) => {
          const stats = summariesByChangeId[change.id]
          if (!stats) return acc
          acc.added += stats.added
          acc.deleted += stats.deleted
          return acc
        },
        { added: 0, deleted: 0 }
      ),
    [aggregatedChanges, summariesByChangeId]
  )
  const actionableChanges = React.useMemo(
    () => aggregatedChanges.flatMap((change) => actionableSourceChanges(change)),
    [aggregatedChanges]
  )
  const canCollapseFileList = aggregatedChanges.length > DEFAULT_EXPANDED_FILE_LIMIT
  const [fileListState, setFileListState] = React.useState(() => ({
    changeCount: aggregatedChanges.length,
    collapsed: canCollapseFileList,
    touched: false
  }))
  const fileListCollapsed = canCollapseFileList && fileListState.collapsed

  React.useEffect(() => {
    setFileListState((current) => {
      if (current.touched && current.changeCount === aggregatedChanges.length) return current
      return {
        changeCount: aggregatedChanges.length,
        collapsed: aggregatedChanges.length > DEFAULT_EXPANDED_FILE_LIMIT,
        touched: false
      }
    })
  }, [aggregatedChanges.length])

  if (aggregatedChanges.length === 0) return null

  const handleOpenReview = (): void => {
    const firstChange = aggregatedChanges[0]
    openDetailPanel({
      type: 'change-review',
      runId: firstChange?.runId ?? changeSets[0]?.runId ?? '',
      initialChangeId: firstChange?.lastChangeId ?? null
    })
  }

  const handleRollback = async (): Promise<void> => {
    setIsRollingBack(true)
    try {
      for (const change of [...actionableChanges].sort((a, b) => b.createdAt - a.createdAt)) {
        await rollbackFileChange(change.runId, change.id)
      }
    } finally {
      setIsRollingBack(false)
    }
  }

  const renderChangeRow = (change: AggregatedFileChange): React.JSX.Element => {
    const stats = summariesByChangeId[change.id] ?? { added: 0, deleted: 0 }

    return (
      <button
        key={change.id}
        type="button"
        className="group flex min-h-9 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/35"
        title={change.filePath}
        onClick={handleOpenReview}
      >
        <span
          className="min-w-0 flex-1 truncate text-[13px] text-foreground/90"
          style={{ fontFamily: MONO_FONT }}
        >
          {change.filePath}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-emerald-600 dark:text-emerald-300">
          +{stats.added}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-red-600 dark:text-red-300">
          -{stats.deleted}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/55 transition-colors group-hover:text-foreground" />
      </button>
    )
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-background/95 text-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileCode className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('assistantMessage.editedFiles', { count: aggregatedChanges.length })}
              </h3>
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">
                +{summary.added}
              </span>
              <span className="text-sm font-semibold text-red-600 dark:text-red-300">
                -{summary.deleted}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => void handleRollback()}
            disabled={actionableChanges.length === 0 || isRollingBack}
          >
            {isRollingBack ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCcw className="size-3" />
            )}
            {t('action.undo', { ns: 'common' })}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md border border-border/70 px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/50"
            onClick={handleOpenReview}
          >
            {t('fileChange.reviewButton', { defaultValue: 'Review' })}
          </button>
        </div>
      </div>

      {canCollapseFileList && (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          onClick={() =>
            setFileListState({
              changeCount: aggregatedChanges.length,
              collapsed: !fileListCollapsed,
              touched: true
            })
          }
          aria-expanded={!fileListCollapsed}
        >
          <span>
            {fileListCollapsed
              ? t('fileChange.showFileList', { count: aggregatedChanges.length })
              : t('fileChange.hideFileList', { count: aggregatedChanges.length })}
          </span>
          {fileListCollapsed ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronUp className="size-3.5 shrink-0" />
          )}
        </button>
      )}

      {!fileListCollapsed && (
        <div className="border-t border-border/60 py-1">
          {aggregatedChanges.map((change) => renderChangeRow(change))}
        </div>
      )}
    </div>
  )
}
