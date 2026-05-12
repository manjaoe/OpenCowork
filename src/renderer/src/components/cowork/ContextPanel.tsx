import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
  Database,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  MessageSquare,
  Clock,
  Cpu,
  Zap,
  ExternalLink,
  Copy,
  Check,
  Wrench,
  Brain,
  ShieldCheck,
  Archive,
  Target,
  Pause,
  Play,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { Textarea } from '@renderer/components/ui/textarea'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useGoalStore } from '@renderer/stores/goal-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { isProjectSession } from '@renderer/lib/session-scope'
import {
  formatTokens,
  calculateCost,
  formatCost,
  getBillableInputTokens,
  getBillableTotalTokens
} from '@renderer/lib/format-tokens'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatActions } from '@renderer/hooks/use-chat-actions'
import { toast } from 'sonner'
import {
  formatGoalElapsedSeconds,
  formatGoalTokens,
  goalStatusLabel,
  validateGoalObjective
} from '@renderer/lib/agent/goal-context'
import {
  getCompressionTriggerTokens,
  getEffectiveContextWindow,
  getPreCompressionTriggerTokens,
  resolveCompressionContextLength,
  resolveCompressionReservedOutputBudget,
  resolveCompressionThreshold
} from '@renderer/lib/agent/context-compression'

export function ContextPanel(): React.JSX.Element {
  const { t } = useTranslation('cowork')
  const { t: tCommon } = useTranslation('common')
  const [copiedPath, setCopiedPath] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [showCompressPanel, setShowCompressPanel] = useState(false)
  const [focusPrompt, setFocusPrompt] = useState('')
  const [goalManagerOpen, setGoalManagerOpen] = useState(false)
  const [goalObjectiveDraft, setGoalObjectiveDraft] = useState('')
  const [goalTokenBudgetDraft, setGoalTokenBudgetDraft] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalClearing, setGoalClearing] = useState(false)
  const { manualCompressContext, sendMessage } = useChatActions()
  const {
    activeSessionId,
    resolvedProjectId,
    activeSession,
    activeProject,
    activeProjectId,
    updateProjectDirectory
  } = useChatStore(
    useShallow((s) => {
      const activeSession = s.sessions.find((session) => session.id === s.activeSessionId)
      const resolvedProjectId = activeSession?.projectId ?? s.activeProjectId ?? null
      const activeProject = resolvedProjectId
        ? s.projects.find((project) => project.id === resolvedProjectId)
        : undefined
      return {
        activeSessionId: s.activeSessionId,
        resolvedProjectId,
        activeSession,
        activeProject,
        activeProjectId: s.activeProjectId,
        updateProjectDirectory: s.updateProjectDirectory
      }
    })
  )
  const workingFolder = activeProject?.workingFolder
  const chatView = useUIStore((s) => s.chatView)
  const runningCommandIdsSig = useAgentStore((s) =>
    Object.values(s.backgroundProcesses)
      .filter(
        (p) =>
          p.source === 'bash-tool' &&
          p.status === 'running' &&
          (!activeSessionId || p.sessionId === activeSessionId)
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => p.id)
      .join('\u0000')
  )
  const stopBackgroundProcess = useAgentStore((s) => s.stopBackgroundProcess)
  const openDetailPanel = useUIStore((s) => s.openDetailPanel)
  const providerState = useProviderStore(
    useShallow((s) => ({
      providers: s.providers,
      activeProviderId: s.activeProviderId,
      activeModelId: s.activeModelId
    }))
  )
  const resolvedProviderId = activeSession?.providerId ?? providerState.activeProviderId
  const resolvedModelId = activeSession?.modelId ?? providerState.activeModelId
  const activeProvider =
    providerState.providers.find((provider) => provider.id === resolvedProviderId) ?? null
  const activeModelCfg =
    activeProvider?.models.find((model) => model.id === resolvedModelId) ?? null
  const fallbackProvider = useSettingsStore((s) => s.provider)
  const fallbackModel = useSettingsStore((s) => s.model)
  const provider = activeProvider?.name ?? fallbackProvider
  const model = activeModelCfg?.name ?? fallbackModel
  const compressionConfig = activeModelCfg
    ? {
        enabled: true,
        contextLength: resolveCompressionContextLength(activeModelCfg),
        threshold: resolveCompressionThreshold(activeModelCfg),
        preCompressThreshold: 0.65,
        reservedOutputBudget: resolveCompressionReservedOutputBudget(activeModelCfg)
      }
    : null
  const compressionWindow = compressionConfig ? getEffectiveContextWindow(compressionConfig) : null
  const manualCompressionTrigger = compressionConfig
    ? getPreCompressionTriggerTokens(compressionConfig)
    : null
  const autoCompressionTrigger = compressionConfig
    ? getCompressionTriggerTokens(compressionConfig)
    : null
  const runningCommands = runningCommandIdsSig
    ? runningCommandIdsSig.split('\u0000').reduce(
        (list, id) => {
          const process = useAgentStore.getState().backgroundProcesses[id]
          if (process) list.push(process)
          return list
        },
        [] as Array<ReturnType<typeof useAgentStore.getState>['backgroundProcesses'][string]>
      )
    : []
  const projectScopedSession = isProjectSession({
    chatView,
    session: activeSession,
    activeProjectId,
    workingFolder
  })
  const goal = useGoalStore((s) =>
    activeSessionId ? s.goalsBySession[activeSessionId] : undefined
  )

  const handleSelectFolder = async (): Promise<void> => {
    if (!resolvedProjectId) return
    const result = (await ipcClient.invoke('fs:select-folder')) as {
      canceled?: boolean
      path?: string
    }
    if (result.canceled || !result.path) return

    updateProjectDirectory(resolvedProjectId, {
      workingFolder: result.path,
      sshConnectionId: null
    })
  }

  const openGoalManager = (): void => {
    setGoalObjectiveDraft(goal?.objective ?? '')
    setGoalTokenBudgetDraft(
      goal?.tokenBudget !== undefined && goal.tokenBudget !== null ? String(goal.tokenBudget) : ''
    )
    setGoalManagerOpen(true)
  }

  const parseGoalTokenBudget = (): { tokenBudget: number | null; error?: string } => {
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
  }

  const handleGoalStatus = async (status: 'active' | 'paused'): Promise<void> => {
    if (!activeSessionId) return
    const result = await useGoalStore.getState().updateGoal(activeSessionId, { status })
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
        void sendMessage('', undefined, 'continue', activeSessionId, null)
      })
    }
  }

  const handleGoalClear = async (): Promise<void> => {
    if (!activeSessionId || !goal) return
    const confirmed = await confirm({
      title: 'Clear this goal?',
      variant: 'destructive'
    })
    if (!confirmed) return
    setGoalClearing(true)
    const result = await useGoalStore.getState().clearGoal(activeSessionId)
    setGoalClearing(false)
    if (!result.success) {
      toast.error('Goal clear failed', { description: result.error })
      return
    }
    setGoalManagerOpen(false)
    setGoalObjectiveDraft('')
    setGoalTokenBudgetDraft('')
  }

  const handleGoalSave = async (): Promise<void> => {
    if (!activeSessionId) return
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
      ? await useGoalStore.getState().updateGoal(activeSessionId, {
          objective,
          tokenBudget: budget.tokenBudget
        })
      : await useGoalStore.getState().setGoal({
          sessionId: activeSessionId,
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
    setGoalManagerOpen(false)
    if (result.goal?.status === 'active') {
      queueMicrotask(() => {
        void sendMessage('', undefined, 'continue', activeSessionId, null)
      })
    }
  }

  return (
    <div className="space-y-4">
      {projectScopedSession && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('context.workingFolder')}
          </h4>
          {workingFolder ? (
            <div className="space-y-1.5">
              <button
                className="group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                onClick={() => {
                  navigator.clipboard.writeText(workingFolder)
                  setCopiedPath(true)
                  setTimeout(() => setCopiedPath(false), 1500)
                }}
                title={t('context.clickToCopy')}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{workingFolder}</span>
                {copiedPath ? (
                  <Check className="size-3 shrink-0 text-green-500" />
                ) : (
                  <Copy className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                )}
              </button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1.5 px-2 text-[10px] text-muted-foreground"
                  onClick={handleSelectFolder}
                >
                  <RefreshCw className="size-3" />
                  {t('context.changeFolder')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1.5 px-2 text-[10px] text-muted-foreground"
                  onClick={() =>
                    window.electron.ipcRenderer.invoke('shell:openPath', workingFolder)
                  }
                >
                  <ExternalLink className="size-3" />
                  {t('context.open')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={handleSelectFolder}
            >
              <FolderPlus className="size-3.5" />
              {t('context.selectFolder')}
            </Button>
          )}
        </div>
      )}

      {/* Session Info */}
      {activeSession && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Target className="size-3.5" />
                Goal
              </h4>
              <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {goal ? goalStatusLabel(goal.status) : 'not set'}
              </span>
            </div>
            {goal ? (
              <>
                <p className="line-clamp-4 break-words text-xs leading-relaxed text-foreground/85">
                  {goal.objective}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{formatGoalElapsedSeconds(goal.timeUsedSeconds)}</span>
                  <span>
                    {goal.tokenBudget !== undefined && goal.tokenBudget !== null
                      ? `${formatGoalTokens(goal.tokensUsed)} / ${formatGoalTokens(goal.tokenBudget)} tokens`
                      : `${formatGoalTokens(goal.tokensUsed)} tokens`}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No session goal.</p>
            )}
            <div className="flex items-center gap-1">
              {goal?.status === 'active' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title="Pause goal"
                  onClick={() => void handleGoalStatus('paused')}
                >
                  <Pause className="size-3.5" />
                </Button>
              ) : goal && goal.status !== 'complete' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title="Resume goal"
                  onClick={() => void handleGoalStatus('active')}
                >
                  <Play className="size-3.5" />
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                title={goal ? 'Manage goal' : 'Set goal'}
                onClick={openGoalManager}
              >
                {goal ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
                {goal ? 'Manage' : 'Set'}
              </Button>
              {goal && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive/80"
                  title="Clear goal"
                  onClick={() => void handleGoalClear()}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
          <Dialog open={goalManagerOpen} onOpenChange={setGoalManagerOpen}>
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
                    onClick={() => setGoalManagerOpen(false)}
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
          <Separator />
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('context.sessionInfo')}
            </h4>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MessageSquare className="size-3 shrink-0" />
                <span>
                  {activeSession.messages.filter((m) => m.role !== 'system').length}{' '}
                  {tCommon('unit.messages')}
                  <span className="text-muted-foreground/50">
                    {' '}
                    ({activeSession.messages.filter((m) => m.role === 'user').length}{' '}
                    {tCommon('unit.turns')})
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-3 shrink-0" />
                <span>
                  Created {new Date(activeSession.createdAt).toLocaleDateString()}
                  {activeSession.messages.length >= 2 &&
                    (() => {
                      const first = activeSession.messages[0]?.createdAt
                      const last =
                        activeSession.messages[activeSession.messages.length - 1]?.createdAt
                      if (!first || !last || last <= first) return null
                      const secs = Math.floor((last - first) / 1000)
                      if (secs < 60) return ` · ${secs}s session`
                      const mins = Math.floor(secs / 60)
                      if (mins < 60) return ` · ${mins}m session`
                      return ` · ${Math.floor(mins / 60)}h${mins % 60}m session`
                    })()}
                </span>
              </div>
              {(() => {
                let toolUseCount = 0
                let subAgentCount = 0
                for (const m of activeSession.messages) {
                  if (Array.isArray(m.content)) {
                    for (const b of m.content) {
                      if (b.type === 'tool_use') {
                        toolUseCount++
                        if (b.name === 'Task') subAgentCount++
                      }
                    }
                  }
                }
                return toolUseCount > 0 ? (
                  <>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wrench className="size-3 shrink-0" />
                      <span>{t('context.toolCalls', { count: toolUseCount })}</span>
                    </div>
                    {subAgentCount > 0 && (
                      <div className="flex items-center gap-2 text-violet-500/70">
                        <Brain className="size-3 shrink-0" />
                        <span>{t('context.subAgentRuns', { count: subAgentCount })}</span>
                      </div>
                    )}
                  </>
                ) : null
              })()}
              {(() => {
                const approved = useAgentStore.getState().approvedToolNames
                return approved.length > 0 ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="size-3 shrink-0 text-green-500/60" />
                    <span className="text-muted-foreground/60">
                      Auto-approved: {approved.join(', ')}
                    </span>
                  </div>
                ) : null
              })()}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="size-3 shrink-0" />
                <span className="truncate">
                  {model} ({provider})
                </span>
              </div>
              {runningCommands.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Wrench className="size-3 shrink-0" />
                    <span>{t('context.runningCommands', { count: runningCommands.length })}</span>
                  </div>
                  <div className="space-y-1">
                    {runningCommands.map((proc) => (
                      <div key={proc.id} className="rounded-md border px-2 py-1.5 text-[11px]">
                        <div className="truncate font-mono text-foreground/85">{proc.command}</div>
                        {proc.cwd && (
                          <div className="truncate text-muted-foreground/50">{proc.cwd}</div>
                        )}
                        <div className="mt-1 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground"
                            onClick={() =>
                              openDetailPanel({ type: 'terminal', processId: proc.id })
                            }
                          >
                            {t('context.openSession')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 gap-1 px-1.5 text-[10px] text-destructive/80"
                            onClick={() => void stopBackgroundProcess(proc.id)}
                          >
                            {t('context.stopCommand')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(() => {
                const totals = activeSession.messages.reduce(
                  (acc, m) => {
                    if (m.usage) {
                      acc.input += getBillableInputTokens(m.usage, activeModelCfg?.type)
                      acc.output += m.usage.outputTokens
                      if (m.usage.cacheCreationTokens)
                        acc.cacheCreation += m.usage.cacheCreationTokens
                      if (m.usage.cacheCreation5mTokens)
                        acc.cacheCreation5m += m.usage.cacheCreation5mTokens
                      if (m.usage.cacheCreation1hTokens)
                        acc.cacheCreation1h += m.usage.cacheCreation1hTokens
                      if (m.usage.cacheReadTokens) acc.cacheRead += m.usage.cacheReadTokens
                      if (m.usage.reasoningTokens) acc.reasoning += m.usage.reasoningTokens
                    }
                    return acc
                  },
                  {
                    input: 0,
                    output: 0,
                    cacheCreation: 0,
                    cacheCreation5m: 0,
                    cacheCreation1h: 0,
                    cacheRead: 0,
                    reasoning: 0
                  }
                )
                // Include team member token usage (active team + history for this session)
                const teamStore = useTeamStore.getState()
                const allTeamMembers = [
                  ...(teamStore.activeTeam?.sessionId === activeSessionId
                    ? teamStore.activeTeam.members
                    : []),
                  ...teamStore.teamHistory
                    .filter((t) => t.sessionId === activeSessionId)
                    .flatMap((t) => t.members)
                ]
                for (const member of allTeamMembers) {
                  if (member.usage) {
                    totals.input += getBillableInputTokens(member.usage, activeModelCfg?.type)
                    totals.output += member.usage.outputTokens
                    if (member.usage.cacheCreationTokens)
                      totals.cacheCreation += member.usage.cacheCreationTokens
                    if (member.usage.cacheCreation5mTokens)
                      totals.cacheCreation5m += member.usage.cacheCreation5mTokens
                    if (member.usage.cacheCreation1hTokens)
                      totals.cacheCreation1h += member.usage.cacheCreation1hTokens
                    if (member.usage.cacheReadTokens)
                      totals.cacheRead += member.usage.cacheReadTokens
                    if (member.usage.reasoningTokens)
                      totals.reasoning += member.usage.reasoningTokens
                  }
                }
                const hasTokenUsage = totals.input + totals.output > 0
                const totalUsage = {
                  inputTokens: totals.input,
                  outputTokens: totals.output,
                  billableInputTokens: totals.input,
                  cacheCreationTokens: totals.cacheCreation || undefined,
                  cacheCreation5mTokens: totals.cacheCreation5m || undefined,
                  cacheCreation1hTokens: totals.cacheCreation1h || undefined,
                  cacheReadTokens: totals.cacheRead || undefined
                }
                const cost = hasTokenUsage ? calculateCost(totalUsage, activeModelCfg) : null
                const totalTokens = hasTokenUsage
                  ? getBillableTotalTokens(totalUsage, activeModelCfg?.type)
                  : 0
                const lastUsage = [...activeSession.messages].reverse().find((m) => {
                  if (!m.usage) return false
                  return (m.usage.contextTokens ?? 0) > 0
                })?.usage
                const ctxUsed = lastUsage?.contextTokens ?? 0
                const ctxLimit =
                  lastUsage?.contextLength ?? compressionConfig?.contextLength ?? null
                const ctxGaugeLimit = compressionWindow ?? ctxLimit
                const pct = ctxGaugeLimit ? Math.min((ctxUsed / ctxGaugeLimit) * 100, 100) : null
                const barColor =
                  pct === null
                    ? ''
                    : pct > 80
                      ? 'bg-red-500'
                      : pct > 50
                        ? 'bg-amber-500'
                        : 'bg-green-500'
                if (!hasTokenUsage && pct === null) return null
                return (
                  <>
                    {hasTokenUsage && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Zap className="size-3 shrink-0" />
                        <span>
                          {formatTokens(totalTokens)} tokens
                          <span className="text-muted-foreground/50">
                            {' '}
                            ({formatTokens(totals.input)}↓ {formatTokens(totals.output)}↑)
                          </span>
                          {cost !== null && (
                            <span className="text-emerald-500/70"> · {formatCost(cost)}</span>
                          )}
                          {totals.cacheRead > 0 && (
                            <span className="text-green-500/60">
                              {' '}
                              · {formatTokens(totals.cacheRead)} {tCommon('unit.cached')}
                            </span>
                          )}
                          {totals.reasoning > 0 && (
                            <span className="text-blue-500/60">
                              {' '}
                              · {formatTokens(totals.reasoning)} {tCommon('unit.reasoning')}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {pct !== null && (
                      <div className="mt-1 space-y-0.5">
                        <div className="flex items-center justify-between text-[9px] text-muted-foreground/40">
                          <span>{t('compressionBudget', { defaultValue: '压缩预算' })}</span>
                          <span>
                            {formatTokens(ctxUsed)} / {formatTokens(ctxGaugeLimit!)} (
                            {pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {manualCompressionTrigger && autoCompressionTrigger ? (
                          <div className="flex items-center justify-between text-[9px] text-muted-foreground/40">
                            <span>
                              {t('manualCompressionThreshold', {
                                defaultValue: '建议手动压缩 >= {{threshold}}',
                                threshold: formatTokens(manualCompressionTrigger)
                              })}
                            </span>
                            <span>
                              {t('autoCompressionThreshold', {
                                defaultValue: '自动压缩 >= {{threshold}}',
                                threshold: formatTokens(autoCompressionTrigger)
                              })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {activeSession.messages.length >= 8 && !showCompressPanel && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-6 gap-1.5 px-2 text-[10px] text-muted-foreground"
                          disabled={
                            compressing ||
                            !manualCompressionTrigger ||
                            ctxUsed < manualCompressionTrigger
                          }
                          onClick={() => setShowCompressPanel(true)}
                        >
                          <Archive className="size-3" />
                          {compressing ? '压缩中...' : '压缩上下文'}
                        </Button>
                        {manualCompressionTrigger && ctxUsed < manualCompressionTrigger ? (
                          <p className="mt-1 text-[10px] text-muted-foreground/60">
                            {t('manualCompressionHint', {
                              defaultValue: '当前 {{used}}，建议达到 {{threshold}} 后再压缩',
                              used: formatTokens(ctxUsed),
                              threshold: formatTokens(manualCompressionTrigger)
                            })}
                          </p>
                        ) : null}
                      </>
                    )}
                    {showCompressPanel &&
                      manualCompressionTrigger &&
                      ctxUsed >= manualCompressionTrigger && (
                        <div className="mt-1.5 space-y-1.5 rounded-md border p-2">
                          <input
                            type="text"
                            className="w-full rounded border bg-background px-2 py-1 text-[11px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="聚焦方向（可选），如：保留 API 相关变更"
                            value={focusPrompt}
                            onChange={(e) => setFocusPrompt(e.target.value)}
                            disabled={compressing}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !compressing) {
                                e.preventDefault()
                                setCompressing(true)
                                manualCompressContext(focusPrompt || undefined).finally(() => {
                                  setCompressing(false)
                                  setShowCompressPanel(false)
                                  setFocusPrompt('')
                                })
                              }
                            }}
                          />
                          <div className="flex items-center gap-1">
                            <Button
                              variant="default"
                              size="sm"
                              className="h-5 px-2 text-[10px]"
                              disabled={compressing}
                              onClick={() => {
                                setCompressing(true)
                                manualCompressContext(focusPrompt || undefined).finally(() => {
                                  setCompressing(false)
                                  setShowCompressPanel(false)
                                  setFocusPrompt('')
                                })
                              }}
                            >
                              <Archive className="size-3 mr-1" />
                              {compressing ? '压缩中...' : '确认压缩'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-2 text-[10px] text-muted-foreground"
                              disabled={compressing}
                              onClick={() => {
                                setShowCompressPanel(false)
                                setFocusPrompt('')
                              }}
                            >
                              取消
                            </Button>
                          </div>
                        </div>
                      )}
                  </>
                )
              })()}
            </div>
          </div>
        </>
      )}

      {!projectScopedSession && !activeSession && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Database className="mb-3 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('context.noContext')}</p>
          <p className="mt-1 text-xs text-muted-foreground/60">{t('context.noContextDesc')}</p>
        </div>
      )}
    </div>
  )
}
