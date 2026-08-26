import {
  usePersistenceStore,
  type PersistenceStatus,
} from '../persistence/persistenceStore'

/**
 * What each state says out loud. Short, because it lives in a toolbar, and
 * plain, because "IDB_ERR" is not a thing to tell a person about their work.
 */
const LABELS: Record<PersistenceStatus, string> = {
  loading: 'Opening…',
  ready: 'Auto-save on',
  saving: 'Saving…',
  saved: 'Saved',
  unavailable: 'Not saved',
}

const CONFIRMATION =
  'Delete the saved diagram and start with an empty canvas? This cannot be undone.'

/**
 * The storage chip, and the control that forgets everything.
 *
 * **Discreet, and never in the way.** Storage failing is not an error the user
 * caused or can fix, and it does not stop them working: the editor is complete
 * without it. So a private window gets a quiet "Not saved" in the corner with
 * the reason on hover, and no dialog, no banner and no retry button. What it
 * must not do is stay silent — a user who believes they are being saved and is
 * not has been actively misled.
 *
 * `aria-live="polite"` rather than `assertive` for the same reason: worth
 * announcing when it changes, never worth interrupting for.
 *
 * **Clear** wipes the stored records *and* empties the canvas — see
 * `session.clear` on why it cannot sensibly do only the first. That makes it
 * genuinely destructive, so it is the one place in this app that asks. The
 * platform's own `confirm` rather than a hand-rolled modal: it is a single
 * irreversible yes/no, which is precisely what `confirm` is for, and building
 * a dialog with its own focus trap to ask the same question would be a lot of
 * code standing between the user and an answer.
 */
export function StorageStatus() {
  const status = usePersistenceStore((state) => state.status)
  const message = usePersistenceStore((state) => state.message)
  const repairs = usePersistenceStore((state) => state.repairs)
  const session = usePersistenceStore((state) => state.session)

  const detail = message ?? (repairs.length > 0 ? repairs.join('\n') : null)

  return (
    <div className="toolbar__group toolbar__group--end">
      <span
        className="toolbar__status"
        data-testid="storage-status"
        data-status={status}
        title={detail ?? undefined}
        aria-live="polite"
      >
        {LABELS[status]}
        {repairs.length > 0 && (
          <span className="toolbar__status-note" data-testid="storage-repairs">
            repaired
          </span>
        )}
      </span>

      <button
        type="button"
        className="toolbar__button"
        data-testid="clear-storage"
        disabled={session === null}
        title="Delete the saved diagram and start over"
        onClick={() => {
          if (!session) return
          if (!window.confirm(CONFIRMATION)) return
          void session.clear()
        }}
      >
        Clear
      </button>
    </div>
  )
}
