import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { getNativeWorker } from '../lib/native-worker'
import type { McpManager } from '../mcp/mcp-manager'
import type { McpServerConfig } from '../mcp/mcp-types'
import type { ExtensionInstance, ExtensionManifest } from '../../shared/extension-types'
import { nativeExtensionRequest } from './extension-native-bridge'
import { nativeSkillsRequest } from './skills-handlers'
import { getBundledResourceDirCandidates } from './user-content-native'

const OPEN_COWORK_DIR = path.join(os.homedir(), '.open-cowork')
const SYNC_STATE_PATH = path.join(OPEN_COWORK_DIR, 'extensions-sync.json')
const MCP_CONFIG_TIMEOUT_MS = 60_000

interface ExtensionSyncRecord {
  version: string
  syncedAt: number
  skills: string[]
  agents: string[]
  commands: string[]
  mcpServerIds: string[]
}

type ExtensionSyncState = Record<string, ExtensionSyncRecord>

export interface ExtensionAggregateInfo {
  declared: {
    skills: number
    agents: number
    commands: number
    mcpServers: number
    state: boolean
  }
  // Names of the focused workflow skills nested inside a bundled skill (the
  // progressive-disclosure pattern used by imported Codex plugins: one router
  // skill that links to many workflows). Empty for flat skills.
  workflows: string[]
  synced: {
    skills: string[]
    agents: number
    commands: number
    mcpServers: string[]
    syncedAt: number
  } | null
}

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function warn(warnings: string[], message: string): void {
  warnings.push(message)
  console.warn(`[ExtensionSync] ${message}`)
}

function emptyRecord(version: string): ExtensionSyncRecord {
  return { version, syncedAt: 0, skills: [], agents: [], commands: [], mcpServerIds: [] }
}

async function readSyncState(): Promise<ExtensionSyncState> {
  try {
    const raw = await fs.readFile(SYNC_STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ExtensionSyncState) : {}
  } catch {
    return {}
  }
}

async function writeSyncState(state: ExtensionSyncState): Promise<void> {
  await fs.mkdir(OPEN_COWORK_DIR, { recursive: true })
  await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
}

async function resolveExtensionRoot(id: string): Promise<string | null> {
  try {
    const result = await nativeExtensionRequest<{ success: boolean; path?: string }>(
      'extension/resolve-path',
      { id }
    )
    return result.success && result.path ? result.path : null
  } catch {
    return null
  }
}

async function readRawManifest(extensionRoot: string): Promise<ExtensionManifest | null> {
  try {
    const raw = await fs.readFile(path.join(extensionRoot, 'extension.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null
    return parsed as ExtensionManifest
  } catch {
    return null
  }
}

function hasAggregateResources(manifest: ExtensionManifest): boolean {
  return Boolean(
    manifest.skills ||
    manifest.agents ||
    manifest.commands ||
    (manifest.mcpServers && Object.keys(manifest.mcpServers).length > 0) ||
    manifest.state
  )
}

function resolveInsideRoot(root: string, relative: string): string | null {
  const resolved = path.resolve(root, relative)
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => path.join(dir, entry.name))
}

async function listSkillFolders(skillsRoot: string): Promise<string[]> {
  const hasOwnSkillMd = await fs
    .access(path.join(skillsRoot, 'SKILL.md'))
    .then(() => true)
    .catch(() => false)
  if (hasOwnSkillMd) return [skillsRoot]

  const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const folders: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(skillsRoot, entry.name)
    const exists = await fs
      .access(path.join(candidate, 'SKILL.md'))
      .then(() => true)
      .catch(() => false)
    if (exists) folders.push(candidate)
  }
  return folders
}

// Names of the built-in (bundled) skills. These ship with the app and must
// never be adopted or deleted by an extension's sync lifecycle, even when a
// Codex plugin bundles a skill of the same name (e.g. `pdf`).
async function getBuiltinSkillNames(): Promise<Set<string>> {
  for (const dir of getBundledResourceDirCandidates('skills')) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      if (names.length > 0) return new Set(names)
    } catch {
      // try next candidate
    }
  }
  return new Set()
}

// An imported Codex plugin is one wrapper skill whose focused workflow skills
// are nested under `<wrapper>/skills/*/SKILL.md`. Return those workflow names so
// the UI can show what the plugin actually provides beyond its single router.
async function listNestedWorkflowNames(wrapperFolder: string): Promise<string[]> {
  const nestedRoot = path.join(wrapperFolder, 'skills')
  const entries = await fs.readdir(nestedRoot, { withFileTypes: true }).catch(() => [])
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMd = path.join(nestedRoot, entry.name, 'SKILL.md')
    if (
      await fs
        .access(skillMd)
        .then(() => true)
        .catch(() => false)
    ) {
      names.push(await readSkillName(path.join(nestedRoot, entry.name)))
    }
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

async function readSkillName(skillFolder: string): Promise<string> {
  try {
    const content = await fs.readFile(path.join(skillFolder, 'SKILL.md'), 'utf8')
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const nameLine = frontmatter?.[1].match(/^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)
    if (nameLine) return nameLine[1].trim()
  } catch {
    // fall through to folder basename
  }
  return path.basename(skillFolder)
}

// ── Per-resource sync ──

async function syncSkills(
  manifest: ExtensionManifest,
  root: string,
  previous: string[],
  warnings: string[]
): Promise<string[]> {
  if (!manifest.skills) return []
  const skillsRoot = resolveInsideRoot(root, manifest.skills)
  if (!skillsRoot) {
    warn(warnings, `${manifest.id}: skills path escapes extension root, skipped`)
    return []
  }

  const folders = await listSkillFolders(skillsRoot)
  const builtinNames = await getBuiltinSkillNames()
  const synced: string[] = []

  for (const folder of folders) {
    const skillName = await readSkillName(folder)
    if (builtinNames.has(skillName)) {
      // Collides with a built-in skill. Never adopt or overwrite it — adopting
      // would delete the built-in when this extension is disabled/removed. Skip
      // quietly; the built-in keeps working, this extension just does not add a
      // conflicting copy.
      console.info(
        `[ExtensionSync] ${manifest.id}: skill "${skillName}" collides with a built-in, skipped`
      )
      continue
    }
    const result = await nativeSkillsRequest<{ success: boolean; name?: string; error?: string }>(
      'skills/add-from-folder',
      { sourcePath: folder }
    )
    // "Already exists" counts as present: this is either a re-sync of a skill we
    // own or recovery of one whose ownership record was lost. Either way the
    // skill is on disk and belongs to this extension, so record it as synced so
    // the stale cleanup below does not delete it.
    if (result.success || /exist/i.test(result.error ?? '')) {
      synced.push(result.name ?? skillName)
    } else {
      warn(warnings, `${manifest.id}: skill "${skillName}" sync failed: ${result.error}`)
    }
  }

  for (const stale of previous.filter(
    (name) => !synced.includes(name) && !builtinNames.has(name)
  )) {
    await nativeSkillsRequest<{ success: boolean }>('skills/delete', { name: stale }).catch(
      () => undefined
    )
  }
  return synced
}

async function syncMarkdownDir(
  extensionId: string,
  root: string,
  relativeDir: string,
  targetDir: string,
  previous: string[],
  namespaceFileName: boolean,
  warnings: string[]
): Promise<string[]> {
  const sourceDir = resolveInsideRoot(root, relativeDir)
  if (!sourceDir) {
    warn(warnings, `${extensionId}: path "${relativeDir}" escapes extension root`)
    return []
  }

  const files = await listMarkdownFiles(sourceDir)
  const owned = new Set(previous)
  await fs.mkdir(targetDir, { recursive: true })
  const synced: string[] = []

  for (const file of files) {
    const baseName = namespaceFileName
      ? `${extensionId}--${path.basename(file)}`
      : path.basename(file)
    const target = path.join(targetDir, baseName)
    const exists = await fs
      .access(target)
      .then(() => true)
      .catch(() => false)
    if (exists && !owned.has(target)) {
      warn(
        warnings,
        `${extensionId}: "${baseName}" already exists in ${targetDir} and is not owned by this extension, skipped`
      )
      continue
    }
    await fs.copyFile(file, target)
    synced.push(target)
  }

  for (const stale of previous.filter((target) => !synced.includes(target))) {
    await fs.unlink(stale).catch(() => undefined)
  }
  return synced
}

function extensionMcpServerId(extensionId: string, serverName: string): string {
  const safeName = serverName.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return `ext-${extensionId}-${safeName}`
}

async function syncMcpServers(
  manifest: ExtensionManifest,
  root: string,
  previous: string[],
  mcpManager: McpManager | null,
  warnings: string[]
): Promise<string[]> {
  const servers = Object.entries(manifest.mcpServers ?? {})
  const existing = await getNativeWorker()
    .request<McpServerConfig[]>('mcp/config-list', {}, MCP_CONFIG_TIMEOUT_MS)
    .catch(() => [] as McpServerConfig[])
  const existingIds = new Set(existing.map((server) => server.id))
  const synced: string[] = []

  for (const [serverName, definition] of servers) {
    const id = extensionMcpServerId(manifest.id, serverName)
    const config: McpServerConfig = {
      id,
      name: `${manifest.name}: ${serverName}`,
      enabled: true,
      transport: definition.transport ?? (definition.url ? 'streamable-http' : 'stdio'),
      command: definition.command,
      args: definition.args,
      env: definition.env,
      cwd: definition.cwd ? (resolveInsideRoot(root, definition.cwd) ?? root) : root,
      url: definition.url,
      headers: definition.headers,
      createdAt: Date.now(),
      description: definition.description ?? `Provided by extension ${manifest.id}`
    }

    const result = existingIds.has(id)
      ? await getNativeWorker().request<{ success: boolean; error?: string }>(
          'mcp/config-update',
          { id, patch: config },
          MCP_CONFIG_TIMEOUT_MS
        )
      : await getNativeWorker().request<{ success: boolean; error?: string }>(
          'mcp/config-add',
          config,
          MCP_CONFIG_TIMEOUT_MS
        )
    if (!result.success) {
      warn(warnings, `${manifest.id}: MCP server "${serverName}" sync failed: ${result.error}`)
      continue
    }
    synced.push(id)
    if (mcpManager) {
      await mcpManager.connectServer(config).catch((err) => {
        warn(
          warnings,
          `${manifest.id}: MCP server "${serverName}" registered but failed to connect: ${err}`
        )
      })
    }
  }

  for (const stale of previous.filter((id) => !synced.includes(id))) {
    await removeMcpServer(stale, mcpManager)
  }
  return synced
}

async function removeMcpServer(id: string, mcpManager: McpManager | null): Promise<void> {
  if (mcpManager) await mcpManager.disconnectServer(id).catch(() => undefined)
  await getNativeWorker()
    .request('mcp/config-remove', id, MCP_CONFIG_TIMEOUT_MS)
    .catch(() => undefined)
}

export function getExtensionStateDir(extensionId: string): string {
  return path.join(OPEN_COWORK_DIR, 'state', 'plugins', extensionId)
}

// ── Public lifecycle API ──

async function syncExtensionInternal(
  id: string,
  mcpManager: McpManager | null,
  force: boolean
): Promise<string[]> {
  const warnings: string[] = []
  const root = await resolveExtensionRoot(id)
  if (!root) return warnings
  const manifest = await readRawManifest(root)
  if (!manifest) return warnings

  const state = await readSyncState()
  const previous = state[id]
  if (!hasAggregateResources(manifest)) {
    if (previous) await unsyncExtensionInternal(id, mcpManager)
    return warnings
  }
  if (!force && previous && previous.version === manifest.version && previous.syncedAt > 0) {
    return warnings
  }

  const record = previous ?? emptyRecord(manifest.version)
  record.version = manifest.version

  try {
    record.skills = await syncSkills(manifest, root, record.skills, warnings)
  } catch (err) {
    warn(warnings, `${id}: skills sync failed: ${err}`)
  }
  try {
    record.agents = manifest.agents
      ? await syncMarkdownDir(
          id,
          root,
          manifest.agents,
          path.join(OPEN_COWORK_DIR, 'agents'),
          record.agents,
          true,
          warnings
        )
      : []
  } catch (err) {
    warn(warnings, `${id}: agents sync failed: ${err}`)
  }
  try {
    record.commands = manifest.commands
      ? await syncMarkdownDir(
          id,
          root,
          manifest.commands,
          path.join(OPEN_COWORK_DIR, 'commands'),
          record.commands,
          false,
          warnings
        )
      : []
  } catch (err) {
    warn(warnings, `${id}: commands sync failed: ${err}`)
  }
  try {
    record.mcpServerIds = await syncMcpServers(
      manifest,
      root,
      record.mcpServerIds,
      mcpManager,
      warnings
    )
  } catch (err) {
    warn(warnings, `${id}: MCP sync failed: ${err}`)
  }
  if (manifest.state) {
    await fs.mkdir(getExtensionStateDir(id), { recursive: true }).catch(() => undefined)
  }

  record.syncedAt = Date.now()
  state[id] = record
  await writeSyncState(state)
  return warnings
}

async function unsyncExtensionInternal(id: string, mcpManager: McpManager | null): Promise<void> {
  const state = await readSyncState()
  const record = state[id]
  if (!record) return

  const builtinNames = await getBuiltinSkillNames()
  for (const skillName of record.skills) {
    // Never delete a built-in skill, even if a stale record listed it.
    if (builtinNames.has(skillName)) continue
    await nativeSkillsRequest<{ success: boolean }>('skills/delete', { name: skillName }).catch(
      () => undefined
    )
  }
  for (const file of [...record.agents, ...record.commands]) {
    await fs.unlink(file).catch(() => undefined)
  }
  for (const serverId of record.mcpServerIds) {
    await removeMcpServer(serverId, mcpManager)
  }
  // Extension state under state/plugins/<id>/ is user data and is kept on purpose.

  delete state[id]
  await writeSyncState(state)
}

export function syncExtensionResources(
  id: string,
  mcpManager: McpManager | null
): Promise<string[]> {
  return enqueue(() =>
    syncExtensionInternal(id, mcpManager, true).catch((err) => {
      console.error(`[ExtensionSync] sync failed for ${id}:`, err)
      return [`${id}: sync failed: ${err}`]
    })
  )
}

export async function getExtensionAggregateInfo(id: string): Promise<ExtensionAggregateInfo> {
  const empty: ExtensionAggregateInfo = {
    declared: { skills: 0, agents: 0, commands: 0, mcpServers: 0, state: false },
    workflows: [],
    synced: null
  }
  const root = await resolveExtensionRoot(id)
  if (!root) return empty
  const manifest = await readRawManifest(root)
  if (!manifest) return empty

  let skills = 0
  const workflows: string[] = []
  if (manifest.skills) {
    const skillsRoot = resolveInsideRoot(root, manifest.skills)
    if (skillsRoot) {
      const skillFolders = await listSkillFolders(skillsRoot).catch(() => [])
      skills = skillFolders.length
      for (const folder of skillFolders) {
        workflows.push(...(await listNestedWorkflowNames(folder)))
      }
    }
  }
  const countMarkdown = async (relative?: string): Promise<number> => {
    if (!relative) return 0
    const dir = resolveInsideRoot(root, relative)
    if (!dir) return 0
    return (await listMarkdownFiles(dir).catch(() => [])).length
  }

  const record = (await readSyncState())[id]
  return {
    declared: {
      skills,
      agents: await countMarkdown(manifest.agents),
      commands: await countMarkdown(manifest.commands),
      mcpServers: Object.keys(manifest.mcpServers ?? {}).length,
      state: manifest.state === true
    },
    workflows,
    synced: record
      ? {
          skills: record.skills,
          agents: record.agents.length,
          commands: record.commands.length,
          mcpServers: record.mcpServerIds,
          syncedAt: record.syncedAt
        }
      : null
  }
}

export function unsyncExtensionResources(id: string, mcpManager: McpManager | null): Promise<void> {
  return enqueue(() =>
    unsyncExtensionInternal(id, mcpManager).catch((err) => {
      console.error(`[ExtensionSync] unsync failed for ${id}:`, err)
    })
  )
}

export function reconcileExtensionSync(mcpManager: McpManager | null): Promise<void> {
  return enqueue(async () => {
    let extensions: ExtensionInstance[] = []
    try {
      extensions = await nativeExtensionRequest<ExtensionInstance[]>('extension/list')
    } catch (err) {
      console.warn('[ExtensionSync] reconcile skipped, extension list unavailable:', err)
      return
    }

    const known = new Map(extensions.map((extension) => [extension.id, extension]))
    const state = await readSyncState()

    for (const staleId of Object.keys(state).filter((id) => !known.has(id))) {
      await unsyncExtensionInternal(staleId, mcpManager).catch((err) => {
        console.warn(`[ExtensionSync] cleanup failed for removed extension ${staleId}:`, err)
      })
    }

    for (const extension of extensions) {
      if (extension.enabled) {
        await syncExtensionInternal(extension.id, mcpManager, false).catch((err) => {
          console.warn(`[ExtensionSync] reconcile sync failed for ${extension.id}:`, err)
        })
      } else if (state[extension.id]) {
        await unsyncExtensionInternal(extension.id, mcpManager).catch((err) => {
          console.warn(`[ExtensionSync] reconcile unsync failed for ${extension.id}:`, err)
        })
      }
    }
  })
}
