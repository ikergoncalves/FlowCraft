import { create } from 'zustand'
import type { PersistenceSession } from './session'

/**
 * What the status line in the toolbar knows.
 *
 * A store rather than a prop chain because the two things that write it — the
 * startup sequence and the auto-save — are both outside React, and the one
 * thing that reads it is a chip in a corner. Nothing else in the app branches
 * on it: the editor behaves identically whether storage works or not, which is
 * the point.
 */
export type PersistenceStatus =
  /** Opening storage and reading what is in it. */
  | 'loading'
  /** Storage works and there is nothing outstanding. */
  | 'ready'
  | 'saving'
  | 'saved'
  /**
   * Running without storage. Not an error state the user has to clear — the
   * editor works, the session simply will not outlive the tab.
   */
  | 'unavailable'

export interface PersistenceState {
  status: PersistenceStatus
  /** Why storage is unavailable, or what a save failed with. Short, plain. */
  message: string | null
  /** What the validator had to fix on the way in, for the report and tests. */
  repairs: string[]
  /**
   * The live session, once it has opened.
   *
   * Kept here rather than in a module variable so that the toolbar's "clear"
   * button can be genuinely disabled until there is something to clear — a
   * button that looks ready and does nothing on the first click is the same
   * mistake the undo button avoided in Phase 4. The import back to
   * `session.ts` is type-only, so there is no cycle at runtime.
   */
  session: PersistenceSession | null
  setStatus: (status: PersistenceStatus, message?: string | null) => void
  setRepairs: (repairs: readonly string[]) => void
  setSession: (session: PersistenceSession | null) => void
  reset: () => void
}

export const usePersistenceStore = create<PersistenceState>()((set) => ({
  status: 'loading',
  message: null,
  repairs: [],
  session: null,

  setStatus: (status, message = null) => {
    set({ status, message })
  },

  setRepairs: (repairs) => {
    set({ repairs: [...repairs] })
  },

  setSession: (session) => {
    set({ session })
  },

  reset: () => {
    set({ status: 'loading', message: null, repairs: [], session: null })
  },
}))
