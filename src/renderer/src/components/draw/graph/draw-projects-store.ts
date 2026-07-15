import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface ProjectsState {
  projects: ProjectMeta[]
  activeProjectId: string | null
  createProject: (name: string, now: number) => string
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  setActiveProject: (id: string) => void
  touchActive: (now: number) => void
}

/** Canvas project list. The graph content of each project lives in its own
 *  localStorage slot (see graph-persistence.ts); this store only holds metadata. */
export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      createProject: (name, now) => {
        const id = nanoid()
        set((s) => ({
          projects: [{ id, name, createdAt: now, updatedAt: now }, ...s.projects],
          activeProjectId: id
        }))
        return id
      },
      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p))
        })),
      deleteProject: (id) =>
        set((s) => {
          const projects = s.projects.filter((p) => p.id !== id)
          const activeProjectId =
            s.activeProjectId === id ? (projects[0]?.id ?? null) : s.activeProjectId
          return { projects, activeProjectId }
        }),
      setActiveProject: (id) => set({ activeProjectId: id }),
      touchActive: (now) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === s.activeProjectId ? { ...p, updatedAt: now } : p
          )
        }))
    }),
    { name: 'open-cowork.draw.projects' }
  )
)
