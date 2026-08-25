import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, type Command } from './command'
import {
  MERGE_WINDOW_MS,
  acceptsMerge,
  mergeHandler,
  openMergePolicy,
  type Mergeable,
} from './merge'

/*
 * The merge *policy*, on its own.
 *
 * Phase 4 grew this logic inside `createMoveCommand`; the tests for it were
 * therefore tests of nudging that happened to also test merging. Extracting
 * the policy makes the four gates directly assertable, and `commands.test.ts`
 * keeps its original nudge cases unchanged — which is the point: this is a
 * refactor, so the old tests must still pass exactly as written.
 */

const noSelection = { selectionBefore: EMPTY_SELECTION, selectionAfter: EMPTY_SELECTION }

const inert: Omit<Command, 'label'> = {
  ...noSelection,
  apply: () => {},
  revert: () => {},
}

/** A command of `kind` carrying a payload, so folds have something to fold. */
const tagged = <K extends string>(
  kind: K,
  mergeKey: string | null,
  value: number,
): Mergeable<K> & { value: number } => ({
  ...inert,
  label: `${kind} ${value}`,
  kind,
  mergeKey,
  value,
})

describe('openMergePolicy', () => {
  it('defaults to never merging', () => {
    // A drag, a resize, a delete — anything that does not opt in.
    expect(openMergePolicy('move', {}).mergeKey).toBeNull()
  })

  it('opens the window from the clock it is given', () => {
    const policy = openMergePolicy('move', { mergeKey: 'k', now: 1000 })
    expect(policy.openUntil).toBe(1000 + MERGE_WINDOW_MS)
  })

  it('honours a custom window', () => {
    const policy = openMergePolicy('move', { mergeKey: 'k', now: 0, mergeWindowMs: 40 })
    expect(policy.openUntil).toBe(40)
  })
})

describe('acceptsMerge', () => {
  const policy = openMergePolicy('style', { mergeKey: 'fill:a', now: 1000 })

  it('accepts the same kind and key inside the window', () => {
    expect(acceptsMerge(policy, tagged('style', 'fill:a', 1), 1100)).toBe(true)
  })

  it('accepts a command arriving on the very edge of the window', () => {
    const edge = 1000 + MERGE_WINDOW_MS
    expect(acceptsMerge(policy, tagged('style', 'fill:a', 1), edge)).toBe(true)
  })

  it('refuses one that arrives a millisecond late', () => {
    const late = 1000 + MERGE_WINDOW_MS + 1
    expect(acceptsMerge(policy, tagged('style', 'fill:a', 1), late)).toBe(false)
  })

  it('refuses a different merge key', () => {
    // Styling one selection then another is two edits, however fast.
    expect(acceptsMerge(policy, tagged('style', 'fill:b', 1), 1100)).toBe(false)
  })

  it('refuses a different kind carrying the same key', () => {
    // The key alone is not enough: two command types could pick the same
    // string, and folding a move into a style edit would corrupt both.
    expect(acceptsMerge(policy, tagged('move', 'fill:a', 1), 1100)).toBe(false)
  })

  it('refuses anything when the policy has no key', () => {
    const never = openMergePolicy('style', { now: 1000 })
    expect(acceptsMerge(never, tagged('style', null, 1), 1000)).toBe(false)
  })

  it('refuses a plain command with no merge metadata at all', () => {
    const plain: Command = { ...inert, label: 'Delete block' }
    expect(acceptsMerge(policy, plain, 1100)).toBe(false)
  })
})

describe('mergeHandler', () => {
  const policy = openMergePolicy('style', { mergeKey: 'fill:a', now: 1000 })

  it('hands the fold a successor narrowed to the command type', () => {
    const handler = mergeHandler<'style', Mergeable<'style'> & { value: number }>(
      policy,
      (next) => ({ ...inert, label: `folded ${next.value}` }),
    )

    expect(handler(tagged('style', 'fill:a', 7), 1100)?.label).toBe('folded 7')
  })

  it('returns null rather than folding when a gate refuses', () => {
    const handler = mergeHandler<'style', Mergeable<'style'>>(policy, () => {
      throw new Error('fold must not run for a refused merge')
    })

    expect(handler(tagged('style', 'fill:b', 1), 1100)).toBeNull()
    expect(handler(tagged('style', 'fill:a', 1), 9999)).toBeNull()
  })
})
