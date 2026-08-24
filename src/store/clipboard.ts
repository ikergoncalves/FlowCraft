import type { ElementSet } from '../utils/clone'

/**
 * An editor-internal clipboard.
 *
 * Deliberately *not* the system clipboard. `navigator.clipboard` is
 * permission-gated and asynchronous, reading it means accepting arbitrary data
 * from outside the app, and writing to it would need a serialisation format
 * that Phase 6's export work is the right place to design. None of that is
 * needed to make Ctrl+C / Ctrl+V do what a user expects inside one editor
 * session, so this is a module-level box holding a deep copy of a diagram
 * slice — cleared when the page reloads, exactly like the history.
 *
 * Module state rather than a Zustand store because nothing renders from it:
 * the toolbar shows no paste button, so a subscription would have no
 * subscribers.
 */
let clipboard: ElementSet | null = null

/**
 * How many times the current clipboard contents have been pasted.
 *
 * Drives the paste offset, so pasting three times leaves three visibly
 * separate copies rather than a stack of three blocks at one position, which
 * would look exactly like one block until something moved.
 */
let pasteCount = 0

/** Replaces the clipboard, resetting the paste stagger. */
export function writeClipboard(contents: ElementSet): void {
  clipboard = contents
  pasteCount = 0
}

/** The clipboard contents, or `null` when nothing has been copied. */
export function readClipboard(): ElementSet | null {
  return clipboard
}

/**
 * Counts one paste and returns its ordinal, starting at 1.
 *
 * The caller turns that into an offset; keeping the count here means the
 * clipboard owns its own stagger and a fresh copy resets it.
 */
export function nextPasteOrdinal(): number {
  pasteCount += 1
  return pasteCount
}

/** Empties the clipboard. Tests use it; nothing in the UI does yet. */
export function clearClipboard(): void {
  clipboard = null
  pasteCount = 0
}
