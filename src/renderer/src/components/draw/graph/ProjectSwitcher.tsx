import { useState } from 'react'
import { Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { DrawProjectsApi } from './use-draw-projects'

export function ProjectSwitcher({ api }: { api: DrawProjectsApi }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { projects, activeProjectId, newProject, switchProject, renameProject, removeProject } = api
  const active = projects.find((p) => p.id === activeProjectId)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-48 gap-1.5">
            <span className="truncate">
              {active?.name ?? t('drawPage.untitledProject', { defaultValue: 'Untitled' })}
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              className="group/pi gap-2"
              onSelect={() => switchProject(p.id)}
            >
              <Check
                className={cn(
                  'size-4 shrink-0',
                  p.id === activeProjectId ? 'opacity-100' : 'opacity-0'
                )}
              />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="flex items-center gap-0.5 opacity-0 group-hover/pi:opacity-100">
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setRenaming({ id: p.id, name: p.name })
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                {projects.length > 1 && (
                  <button
                    type="button"
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      removeProject(p.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => newProject()}>
            <Plus className="size-4" />
            {t('drawPage.newProject', { defaultValue: 'New canvas' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('drawPage.renameProject', { defaultValue: 'Rename canvas' })}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renaming?.name ?? ''}
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renaming) {
                renameProject(renaming.id, renaming.name)
                setRenaming(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              {t('action.cancel', { ns: 'common', defaultValue: 'Cancel' })}
            </Button>
            <Button
              onClick={() => {
                if (renaming) renameProject(renaming.id, renaming.name)
                setRenaming(null)
              }}
            >
              {t('action.save', { ns: 'common', defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
