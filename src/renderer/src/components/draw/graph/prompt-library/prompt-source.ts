import { BUILTIN_PROMPTS, type PromptItem } from './builtin-prompts'

const CACHE_KEY = 'open-cowork.draw.prompt-library.online'

/**
 * Optional online source: a raw JSON array of `{ id, title, prompt, category }`.
 * raw.githubusercontent.com serves permissive CORS headers, so a direct fetch works.
 * Swap this constant to point at your own curated list.
 */
const ONLINE_URL =
  'https://raw.githubusercontent.com/basketikun/infinite-canvas/main/web/public/prompts.json'

function isPromptItem(value: unknown): value is PromptItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.category === 'string'
  )
}

/** Built-in prompts merged with any cached online prompts (built-ins win on id clash). */
export function loadPrompts(): PromptItem[] {
  let online: PromptItem[] = []
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) online = parsed.filter(isPromptItem)
    }
  } catch {
    online = []
  }
  const seen = new Set(BUILTIN_PROMPTS.map((p) => p.id))
  return [...BUILTIN_PROMPTS, ...online.filter((p) => !seen.has(p.id))]
}

/** Fetch the online source, cache it, and return the merged list. Throws on failure. */
export async function refreshOnlinePrompts(): Promise<PromptItem[]> {
  const res = await fetch(ONLINE_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected format')
  const items = data.filter(isPromptItem)
  localStorage.setItem(CACHE_KEY, JSON.stringify(items))
  return loadPrompts()
}
