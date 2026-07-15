import { useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { PROMPT_CATEGORIES, type PromptItem } from './builtin-prompts'
import { loadPrompts, refreshOnlinePrompts } from './prompt-source'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (prompt: string) => void
}

export function PromptLibraryDialog({ open, onOpenChange, onPick }: Props): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [prompts, setPrompts] = useState<PromptItem[]>(() => loadPrompts())
  const [category, setCategory] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prompts.filter((p) => {
      if (category !== 'all' && p.category !== category) return false
      if (!q) return true
      return p.title.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q)
    })
  }, [category, prompts, query])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setPrompts(await refreshOnlinePrompts())
      toast.success(t('drawPage.promptRefreshed', { defaultValue: 'Prompt library updated' }))
    } catch {
      setPrompts(loadPrompts())
      toast.error(t('drawPage.promptRefreshFailed', { defaultValue: 'Using built-in prompts' }))
    } finally {
      setRefreshing(false)
    }
  }

  const categories = ['all', ...PROMPT_CATEGORIES]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-3xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {t('drawPage.promptLibrary', { defaultValue: 'Prompt library' })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('drawPage.promptSearch', { defaultValue: 'Search prompts…' })}
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('drawPage.promptRefresh', { defaultValue: 'Refresh online' })}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                category === c
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`drawPage.promptCat.${c}`, { defaultValue: c })}
            </button>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50"
            >
              <div className="text-sm font-medium">{p.title}</div>
              <p className="line-clamp-3 flex-1 text-xs text-muted-foreground">{p.prompt}</p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-1 h-7 w-full gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => {
                  onPick(p.prompt)
                  onOpenChange(false)
                }}
              >
                <Plus className="size-3.5" />
                {t('drawPage.promptInsert', { defaultValue: 'Insert' })}
              </Button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full grid place-items-center py-12 text-sm text-muted-foreground">
              {t('drawPage.promptEmpty', { defaultValue: 'No matching prompts' })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
