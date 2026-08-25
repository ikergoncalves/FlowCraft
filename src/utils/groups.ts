import type { Group } from '../types'

/**
 * Group membership as pure functions, kept out of the store for the same
 * reason geometry is: the store owns *state transitions*, not the rules that
 * decide what a transition should be. Every one of these is also what the
 * invariant tests assert against.
 */

/** The parts of the store these functions read. */
export interface GroupSource {
  groups: Record<string, Group>
  groupOrder: readonly string[]
}

/**
 * Fewest members a group may have.
 *
 * Two, because a group of one is indistinguishable from the block itself —
 * every gesture, outline and delete would behave identically — while still
 * costing a record, a bounding box and a rule to remember. A group that falls
 * to one member therefore dissolves rather than lingering as a no-op.
 */
export const MIN_GROUP_SIZE = 2

/** The group `blockId` belongs to, or `null`. A block has at most one. */
export function groupOf(source: GroupSource, blockId: string): Group | null {
  for (const id of source.groupOrder) {
    const group = source.groups[id]
    if (group?.blockIds.includes(blockId)) return group
  }
  return null
}

/**
 * The selection, widened so that no group is only partly in it.
 *
 * This is what makes "click a member, get the group" true everywhere at once —
 * click, marquee and shift-click all run their hits through here rather than
 * each growing its own idea of what a group means.
 *
 * Order follows the ids given, with each group's remaining members appended
 * where the member that pulled them in sat, so a widened selection stays
 * stable rather than being re-sorted under the user.
 */
export function expandToGroups(
  source: GroupSource,
  blockIds: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }

  for (const id of blockIds) {
    const group = groupOf(source, id)
    if (group) for (const member of group.blockIds) push(member)
    else push(id)
  }

  return out
}

/**
 * The groups every one of whose members is selected — the ones that count as
 * "selected groups" and get their own outline.
 *
 * Derived rather than stored. A group has no selection state of its own: since
 * selecting any member widens to all of them, "the group is selected" and "all
 * its members are selected" are the same fact, and storing it twice is how the
 * two copies start disagreeing.
 */
export function selectedGroups(
  source: GroupSource,
  selectedIds: readonly string[],
): Group[] {
  const selected = new Set(selectedIds)
  return source.groupOrder
    .map((id) => source.groups[id])
    .filter(
      (group): group is Group =>
        group !== undefined && group.blockIds.every((id) => selected.has(id)),
    )
}

/** The result of pruning: the surviving map and order, and what was disturbed. */
export interface PrunedGroups {
  groups: Record<string, Group>
  groupOrder: string[]
  /** Every group that lost a member, in the state it was in beforehand. */
  affected: Group[]
}

/**
 * Drops `removedIds` out of every group and dissolves those left too small.
 *
 * Returns the groups it disturbed *as they were*, on exactly the reasoning
 * that made `removeBlocks` return its cascaded connections: by the time undo
 * runs, the membership it would have to reconstruct is gone. Shrunk groups are
 * reported as well as dissolved ones — restoring "a, b and c were grouped" is
 * as much a part of undoing a delete as restoring the group record itself.
 */
export function pruneGroups(
  source: GroupSource,
  removedIds: ReadonlySet<string>,
): PrunedGroups {
  const groups: Record<string, Group> = {}
  const groupOrder: string[] = []
  const affected: Group[] = []

  for (const id of source.groupOrder) {
    const group = source.groups[id]
    if (!group) continue

    const kept = group.blockIds.filter((blockId) => !removedIds.has(blockId))
    if (kept.length === group.blockIds.length) {
      groups[id] = group
      groupOrder.push(id)
      continue
    }

    affected.push({ ...group, blockIds: [...group.blockIds] })
    if (kept.length < MIN_GROUP_SIZE) continue

    groups[id] = { ...group, blockIds: kept }
    groupOrder.push(id)
  }

  return { groups, groupOrder, affected }
}
