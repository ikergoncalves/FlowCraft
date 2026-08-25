import type { Command } from './command'

/**
 * The one merge policy every mergeable command shares.
 *
 * Phase 4 grew this logic inside `createMoveCommand` and the Phase 4 report
 * flagged the duplication that a second mergeable command would cause. Phase 5
 * is that second command — dragging an `<input type="color">` fires `change`
 * on every pointer move, exactly the way a held arrow key repeats — so the
 * policy is extracted here rather than copied.
 *
 * The split is deliberate: this module owns *whether* two commands may fold
 * together, and the command owns *what the folded command is*. A generic
 * helper cannot know that a move keeps the first `before` and the last
 * `after`, and it should not have to.
 */

/**
 * How long a mergeable command stays open to absorbing its successor.
 *
 * Long enough that a held arrow key — which repeats every ~30ms once the
 * initial delay passes — never falls out of the window, short enough that two
 * deliberate presses a second apart stay two separate entries. The window is
 * measured from the *last* merge rather than the first, so a run keeps
 * extending it and collapses into one entry however long it goes on.
 */
export const MERGE_WINDOW_MS = 500

/**
 * The merge metadata a command must expose to take part.
 *
 * `kind` is a runtime tag, because `mergeWith` receives a bare `Command` and
 * structural typing cannot tell a move from a style edit that happens to carry
 * the same fields. `mergeKey` is `null` for commands that never merge — a
 * drag is one edit however fast the next one follows.
 */
export interface Mergeable<K extends string> extends Command {
  readonly kind: K
  readonly mergeKey: string | null
}

/** The knobs a caller passes through to the policy. */
export interface MergeOptions {
  /**
   * Commands sharing a merge key, arriving inside the window, collapse into
   * one entry. `null` — the default — never merges.
   */
  mergeKey?: string | null
  mergeWindowMs?: number
  /** Injectable clock, so the merge window is testable without waiting. */
  now?: number
}

/** A resolved policy: the tag, the key, and the instant the window shuts. */
export interface MergePolicy<K extends string> {
  readonly kind: K
  readonly mergeKey: string | null
  readonly windowMs: number
  readonly openUntil: number
}

/** Resolves `MergeOptions` against a kind, starting the window now. */
export function openMergePolicy<K extends string>(
  kind: K,
  options: MergeOptions,
): MergePolicy<K> {
  const windowMs = options.mergeWindowMs ?? MERGE_WINDOW_MS
  return {
    kind,
    mergeKey: options.mergeKey ?? null,
    windowMs,
    openUntil: (options.now ?? Date.now()) + windowMs,
  }
}

/**
 * Whether `next` may fold into a command governed by `policy`.
 *
 * Four gates, and all four matter: a keyless command never merges; a closed
 * window never merges; a different *kind* never merges (a resize following a
 * nudge is two edits); and a different key never merges, which is what keeps
 * nudging one selection separate from nudging another.
 */
export function acceptsMerge<K extends string>(
  policy: MergePolicy<K>,
  next: Command,
  now: number,
): next is Mergeable<K> {
  if (policy.mergeKey === null) return false
  if (now > policy.openUntil) return false

  const tagged = next as Partial<Mergeable<K>>
  return tagged.kind === policy.kind && tagged.mergeKey === policy.mergeKey
}

/**
 * Builds a `Command.mergeWith` from a policy and a fold.
 *
 * `fold` is handed the successor already narrowed to the command's own shape,
 * and returns the single entry that replaces both. Returning a *new* command
 * rather than mutating either one keeps the history's entries immutable, which
 * is what lets the same command sit on the redo stack and be replayed.
 */
export function mergeHandler<K extends string, C extends Mergeable<K>>(
  policy: MergePolicy<K>,
  fold: (next: C, now: number) => Command,
): NonNullable<Command['mergeWith']> {
  return (next, now) => {
    if (!acceptsMerge(policy, next, now)) return null
    // Narrowing stops at `Mergeable<K>`; the `kind` gate above is what makes
    // the rest of `C` sound, exactly as the hand-rolled guard did before.
    return fold(next as C, now)
  }
}
