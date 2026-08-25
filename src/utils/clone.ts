import type { Block, Connection, Group, Point } from '../types'
import { createId } from './id'

/** A self-contained slice of a diagram: some blocks, arrows and groups. */
export interface ElementSet {
  blocks: Block[]
  connections: Connection[]
  groups: Group[]
}

/** The parts of the store `collectElements` reads. */
export interface ElementSource {
  blocks: Record<string, Block>
  blockOrder: readonly string[]
  connections: Record<string, Connection>
  connectionOrder: readonly string[]
  groups: Record<string, Group>
  groupOrder: readonly string[]
}

/**
 * The named blocks, the connections joining two of them, and the groups whose
 * members are all present.
 *
 * A connection with only one end in the selection is dropped rather than
 * copied: its other end is a block that is not coming along, so pasting it
 * would either dangle or — much worse — silently wire the pasted copy back
 * into the original diagram. Both are surprises, and neither is what "copy
 * these three boxes" means.
 *
 * Groups follow the identical rule, for the identical reason. Copying two of a
 * group's four blocks and bringing the group along would produce a group whose
 * membership refers to blocks that were never copied — the group equivalent of
 * a dangling arrow. So a partly-selected group is left behind and the copies
 * arrive ungrouped, while a wholly-selected one comes across intact.
 *
 * Results come out in paint order, so a paste keeps the layering of what was
 * copied.
 */
export function collectElements(
  source: ElementSource,
  blockIds: readonly string[],
): ElementSet {
  const wanted = new Set(blockIds)

  const blocks: Block[] = []
  for (const id of source.blockOrder) {
    if (!wanted.has(id)) continue
    const block = source.blocks[id]
    if (block)
      blocks.push({ ...block, ...(block.style ? { style: { ...block.style } } : {}) })
  }

  const connections: Connection[] = []
  for (const id of source.connectionOrder) {
    const connection = source.connections[id]
    if (!connection) continue
    if (!wanted.has(connection.sourceId) || !wanted.has(connection.targetId)) continue
    connections.push({
      ...connection,
      ...(connection.style ? { style: { ...connection.style } } : {}),
    })
  }

  const groups: Group[] = []
  for (const id of source.groupOrder) {
    const group = source.groups[id]
    if (!group) continue
    if (!group.blockIds.every((blockId) => wanted.has(blockId))) continue
    groups.push({ ...group, blockIds: [...group.blockIds] })
  }

  return { blocks, connections, groups }
}

/**
 * A copy of `source` under fresh ids, shifted by `offset`.
 *
 * The id map is the whole point. Every block gets a new id, and every
 * connection's endpoints — and every group's membership — are looked up in
 * that map, so the copies wire to and group with each other rather than with
 * the blocks they were copied from. Getting this wrong does not throw and does
 * not look wrong until something moves: the pasted arrows simply stay attached
 * to the originals, and dragging a pasted "group" drags the original blocks.
 *
 * A connection whose endpoint is missing from the map is dropped, and a group
 * is dropped if remapping would leave it below two members. That cannot happen
 * for a set from `collectElements`, which already filters both out, but this
 * function is the last line of defence for the invariant that a pasted element
 * never points outside the paste.
 *
 * `newId` is injectable so tests can assert on the remapping with readable
 * ids instead of UUIDs.
 */
export function cloneElements(
  source: ElementSet,
  offset: Point,
  newId: () => string = createId,
): ElementSet {
  const idMap = new Map<string, string>()

  const blocks = source.blocks.map((block) => {
    const id = newId()
    idMap.set(block.id, id)
    return { ...block, id, x: block.x + offset.x, y: block.y + offset.y }
  })

  const connections: Connection[] = []
  for (const connection of source.connections) {
    const sourceId = idMap.get(connection.sourceId)
    const targetId = idMap.get(connection.targetId)
    if (sourceId === undefined || targetId === undefined) continue
    connections.push({ ...connection, id: newId(), sourceId, targetId })
  }

  const groups: Group[] = []
  for (const group of source.groups) {
    const blockIds = group.blockIds
      .map((blockId) => idMap.get(blockId))
      .filter((blockId): blockId is string => blockId !== undefined)
    if (blockIds.length !== group.blockIds.length || blockIds.length < 2) continue
    groups.push({ id: newId(), blockIds })
  }

  return { blocks, connections, groups }
}
