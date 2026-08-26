import { useHistoryStore } from '../history/historyStore'
import { useDiagramStore, type DiagramState } from '../store/diagramStore'
import { initialTheme, useThemeStore } from '../theme/themeStore'
import { createAutosave, type Autosave } from './autosave'
import { systemTimers, type Timers } from './debounce'
import { DOCUMENT_KEYS, fromDocument, toDocument } from './document'
import { usePersistenceStore } from './persistenceStore'
import { readPreferences, toPreferences } from './preferences'
import { memoryDriver, openIndexedDbDriver, type StorageDriver } from './storage'
import { loadDocument } from './validate'

/**
 * Startup, auto-save and teardown, as one plain function.
 *
 * Not a hook, and not inside a component. Two reasons, and the second is the
 * load-bearing one. It is asynchronous, touches three stores and has to be
 * drivable from a test with an injected driver and an injected clock — a hook
 * would put all of that behind a renderer. And a component that started
 * storage would start it in *every* test that renders the app, so a restore
 * would land, microtasks later, in the middle of tests about dragging and
 * undo, resetting the snap flag and clearing the history they had just set up.
 * Storage has the lifetime of the application, not of a component, so it is
 * started from `main.tsx` alongside the stylesheet.
 *
 * **What is saved.** Two records under two keys — the document (blocks,
 * connections, groups) and the UI preferences (theme, snapping, viewport).
 *
 * **What is not, and why.**
 *
 *  - *The undo history.* Restoring it would be worse than not having it. The
 *    stack holds commands whose `revert` was captured against a document that
 *    is gone the moment the tab closes; a redo replayed against a restored
 *    document is exactly the branch the history layer already refuses to allow
 *    in memory (`record` drops the redo stack for the same reason). Offering
 *    to undo an edit made in a session the user cannot remember is also a
 *    strange thing to offer.
 *  - *The clipboard.* Scoped to a session by design since Phase 4.
 *  - *The selection.* It names ids, and pointing an overlay at blocks the user
 *    chose yesterday is noise, not continuity.
 *  - *The active tool.* One keypress, and restoring it would have the editor
 *    open armed to create a block on the first click.
 *
 * **What counts as a change.** The document auto-save watches the six document
 * slices by reference and nothing else. That is structural rather than a list
 * of exceptions: selecting, panning, zooming, switching tool and toggling the
 * theme cannot trigger a document write, because none of them replaces any of
 * those six references. Preferences are watched the same way, on their own
 * debounce, so a pan writes a preferences record and never a document.
 */

export const DOCUMENT_KEY = 'document'
export const PREFERENCES_KEY = 'preferences'

/** Quiet period before a write. Long enough to swallow a drag, short enough
 *  that closing the tab a second after an edit still keeps it. */
export const SAVE_DELAY_MS = 600

export interface PersistenceOptions {
  /**
   * The driver to use. Omitted, IndexedDB is opened and a failure degrades to
   * an in-memory driver — which is what makes a private window merely
   * unsaved rather than broken.
   */
  driver?: StorageDriver
  delayMs?: number
  timers?: Timers
  /**
   * The window to hang the page-lifecycle listeners on. Injectable so a test
   * can pass `undefined` and get a session with no global listeners at all.
   */
  view?: Window
}

export interface PersistenceSession {
  driver: StorageDriver
  /** Writes anything outstanding now. */
  flush: () => Promise<void>
  /** Forgets the stored state and empties the editor. */
  clear: () => Promise<void>
  stop: () => void
}

/** True when any of the six document slices has been replaced. */
function documentChanged(next: DiagramState, previous: DiagramState): boolean {
  return DOCUMENT_KEYS.some((key) => next[key] !== previous[key])
}

const status = () => usePersistenceStore.getState()

async function openDriver(preferred?: StorageDriver): Promise<StorageDriver> {
  if (preferred) return preferred
  try {
    return await openIndexedDbDriver()
  } catch (error) {
    // Private browsing, a denied permission, a blocked upgrade. None of them
    // is the editor's problem to solve, and all of them are survivable.
    status().setStatus(
      'unavailable',
      error instanceof Error ? error.message : 'Storage is unavailable',
    )
    return memoryDriver()
  }
}

/** Reads one key, treating a read failure as "nothing stored". */
async function readOr(driver: StorageDriver, key: string): Promise<unknown> {
  try {
    return await driver.read(key)
  } catch (error) {
    status().setStatus(
      'unavailable',
      error instanceof Error ? error.message : 'Could not read saved state',
    )
    return undefined
  }
}

export async function startPersistence({
  driver: preferred,
  delayMs = SAVE_DELAY_MS,
  timers = systemTimers,
  view = globalThis.window,
}: PersistenceOptions = {}): Promise<PersistenceSession> {
  const driver = await openDriver(preferred)
  const degraded = () => status().status === 'unavailable'

  /*
   * Preferences first, so the theme settles before the diagram paints.
   *
   * Nothing is applied when there is no stored record. A first visit must
   * leave the running defaults exactly as they are — the theme in particular,
   * which `main.tsx` has already resolved from `prefers-color-scheme`, and
   * which would otherwise be overwritten here by a fallback that knows nothing
   * about the platform.
   */
  const storedPreferences = await readOr(driver, PREFERENCES_KEY)
  if (storedPreferences !== undefined) {
    const preferences = readPreferences(storedPreferences)
    useThemeStore.getState().setTheme(initialTheme(preferences.theme))
    useDiagramStore.getState().setSnapToGrid(preferences.snapToGrid)
    useDiagramStore.getState().setViewport(preferences.viewport)
  }

  /* -- Then the document. */
  const stored = await readOr(driver, DOCUMENT_KEY)
  if (stored !== undefined) {
    const result = loadDocument(stored)
    if (result.ok) {
      useDiagramStore.getState().replaceDocument(fromDocument(result.document))
      status().setRepairs(result.repairs)
    } else {
      // Refused, not repaired — see `validate.ts`. The editor opens empty and
      // says so quietly; the unreadable record is left on disk rather than
      // overwritten, so it is still there to look at.
      status().setRepairs([`The saved diagram could not be read (${result.reason})`])
    }
  }

  /*
   * The restore is not an edit. It runs before the history exists as far as
   * the user is concerned, so an undo offered immediately after opening —
   * which would empty the canvas — has no meaning at all. Skipped when
   * nothing was restored, so that opening on empty storage leaves whatever
   * the session already had untouched.
   */
  if (stored !== undefined) useHistoryStore.getState().clear()
  if (!degraded()) status().setStatus('ready')

  const onError = (error: Error) => {
    // A quota failure mid-session. The document is still in memory and the
    // editor is still an editor; all that is lost is the promise of keeping it.
    status().setStatus('unavailable', error.message)
  }
  const saved = () => {
    if (!degraded()) status().setStatus('saved')
  }
  const saving = () => {
    if (!degraded()) status().setStatus('saving')
  }

  const documentSave: Autosave = createAutosave({
    driver,
    key: DOCUMENT_KEY,
    snapshot: () => toDocument(useDiagramStore.getState()),
    delayMs,
    timers,
    onSaving: saving,
    onSaved: saved,
    onError,
  })

  const preferencesSave: Autosave = createAutosave({
    driver,
    key: PREFERENCES_KEY,
    snapshot: () => {
      const state = useDiagramStore.getState()
      return toPreferences(
        useThemeStore.getState().theme,
        state.snapToGrid,
        state.viewport,
      )
    },
    delayMs,
    timers,
    onError,
  })

  const unsubscribeDocument = useDiagramStore.subscribe((next, previous) => {
    if (documentChanged(next, previous)) documentSave.changed()
    if (next.viewport !== previous.viewport || next.snapToGrid !== previous.snapToGrid) {
      preferencesSave.changed()
    }
  })
  const unsubscribeTheme = useThemeStore.subscribe((next, previous) => {
    if (next.theme !== previous.theme) preferencesSave.changed()
  })

  const flush = async () => {
    await Promise.all([documentSave.flush(), preferencesSave.flush()])
  }

  /*
   * A debounce always leaves a window in which the last edit is not on disk.
   * `pagehide` is the event that actually fires when a mobile tab is
   * discarded — `beforeunload` does not, reliably — and `visibilitychange`
   * catches switching away without closing.
   */
  const flushNow = () => {
    void flush()
  }
  const onVisibilityChange = () => {
    if (view?.document.visibilityState === 'hidden') flushNow()
  }
  view?.addEventListener('pagehide', flushNow)
  view?.document.addEventListener('visibilitychange', onVisibilityChange)

  const session: PersistenceSession = {
    driver,
    flush,
    clear: async () => {
      /*
       * Clearing means "forget everything", so it wipes storage *and* empties
       * the editor. Wiping storage alone would be a button that undid itself:
       * the very next keystroke would save the still-open diagram straight
       * back over the gap.
       *
       * The order matters. Emptying the editor is itself a document change, so
       * it schedules a save through the subscription below; cancelling *after*
       * it — not before — is what stops that write from landing a moment later
       * and putting an empty document back where the deleted one was.
       */
      useDiagramStore.getState().replaceDocument({
        blocks: {},
        blockOrder: [],
        connections: {},
        connectionOrder: [],
        groups: {},
        groupOrder: [],
      })
      useHistoryStore.getState().clear()
      documentSave.cancel()
      preferencesSave.cancel()
      status().setRepairs([])
      try {
        await driver.remove(DOCUMENT_KEY)
        await driver.remove(PREFERENCES_KEY)
        if (!degraded()) status().setStatus('ready')
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    },
    stop: () => {
      view?.removeEventListener('pagehide', flushNow)
      view?.document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribeDocument()
      unsubscribeTheme()
      documentSave.cancel()
      preferencesSave.cancel()
      if (status().session === session) status().setSession(null)
    },
  }

  status().setSession(session)
  return session
}
