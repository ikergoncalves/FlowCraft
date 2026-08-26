import {
  ANCHOR_SIDES,
  type AnchorSide,
  type Block,
  type Connection,
  type Group,
} from '../types'
import { MIN_GROUP_SIZE } from '../utils/groups'
import { DOCUMENT_KEYS, type DiagramDocument } from './document'
import { migrateDocument, type MigrateOptions, type MigrationFailure } from './migrations'

/**
 * Turning whatever came out of storage into a document the store can hold.
 *
 * **Persisted data is external data.** It was written by a build that may no
 * longer exist, on a machine that may have run out of quota half way through,
 * and it comes back through an API that promises only "some value". The store
 * has invariants — every connection joins two live blocks, every group names
 * live blocks, no block is in two groups, no group has fewer than
 * `MIN_GROUP_SIZE` members, every order list agrees with its map — and the
 * whole editor is written on the assumption that they hold. A load is the one
 * door into the store that does not come from a command, so it is the one
 * door that has to check.
 *
 * **Reject the shape, repair the references.** The two failure modes get
 * different answers, and deliberately so:
 *
 *  - A value that is not the right *shape* — not an object, no version,
 *    `blocks` that is an array, a version from the future — is not a FlowCraft
 *    document. There is nothing to salvage that would not be invented, so it
 *    is refused whole and the editor opens empty. Guessing here would mean
 *    manufacturing content the user never made.
 *  - A document of the right shape whose *references* do not hold up is a real
 *    diagram with some broken edges, and its blocks are worth more than its
 *    dangling arrows. So the offending elements are dropped and the rest is
 *    kept. This is not a lenient reading of the rules: dropping an arrow whose
 *    endpoint is gone is exactly what `removeBlocks` would have done had the
 *    block been deleted in a running editor. The repair reproduces the
 *    editor's own cascade rather than inventing a second, laxer notion of
 *    soundness.
 *
 * Every repair is reported rather than performed silently. Nothing in the UI
 * shouts about it, but a load that quietly deletes three arrows and says
 * nothing is indistinguishable from a load that lost them.
 */

export type LoadFailure = MigrationFailure | 'bad-shape'

export type LoadResult =
  | { ok: true; document: DiagramDocument; repairs: string[] }
  | { ok: false; reason: LoadFailure; detail?: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isFinite_ = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const isAnchor = (value: unknown): value is AnchorSide =>
  ANCHOR_SIDES.includes(value as AnchorSide)

/**
 * Keeps the style fields that typecheck and drops the ones that do not.
 *
 * Field-by-field rather than all-or-nothing: a block whose `fontSize` arrived
 * as the string `"14"` still has a perfectly good fill, and throwing the whole
 * style away would repaint a block the user had deliberately coloured.
 *
 * An empty object is preserved as an empty object rather than collapsed to
 * `undefined`, so the round trip stays exactly the identity — the validator
 * must not be the thing that changes a sound document.
 */
function sanitiseStyle(
  value: unknown,
  fields: Record<string, 'string' | 'number' | 'boolean'>,
  report: (repair: string) => void,
  where: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) {
    report(`${where}: dropped a style that was not an object`)
    return undefined
  }

  const kept: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const expected = fields[key]
    if (expected === undefined) {
      report(`${where}: dropped unknown style field "${key}"`)
      continue
    }
    if (expected === 'number' ? isFinite_(entry) : typeof entry === expected) {
      kept[key] = entry
      continue
    }
    report(`${where}: dropped style field "${key}" with the wrong type`)
  }
  return kept
}

const BLOCK_STYLE_FIELDS = {
  fill: 'string',
  stroke: 'string',
  strokeWidth: 'number',
  fontSize: 'number',
  textColor: 'string',
} as const

const CONNECTION_STYLE_FIELDS = {
  stroke: 'string',
  strokeWidth: 'number',
  dashed: 'boolean',
} as const

/** A block, or `null` if this record is not one. */
function readBlock(
  id: string,
  value: unknown,
  report: (repair: string) => void,
): Block | null {
  if (!isPlainObject(value)) return null
  // The id is the map key; a record that disagrees with its own key is
  // ambiguous about which one the connections point at, so it goes.
  if (value.id !== id) return null
  if (value.type !== 'rect' && value.type !== 'text') return null
  if (!isFinite_(value.x) || !isFinite_(value.y)) return null
  if (!isFinite_(value.width) || !isFinite_(value.height)) return null
  if (value.width < 0 || value.height < 0) return null
  if (typeof value.text !== 'string') return null

  const style = sanitiseStyle(value.style, BLOCK_STYLE_FIELDS, report, `block ${id}`)
  return {
    id,
    type: value.type,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    text: value.text,
    ...(style === undefined ? {} : { style }),
  }
}

/** A connection, or `null`. Endpoint existence is checked by the caller. */
function readConnection(
  id: string,
  value: unknown,
  report: (repair: string) => void,
): Connection | null {
  if (!isPlainObject(value)) return null
  if (value.id !== id) return null
  if (!isNonEmptyString(value.sourceId) || !isNonEmptyString(value.targetId)) return null

  const anchors: Partial<Pick<Connection, 'sourceAnchor' | 'targetAnchor'>> = {}
  for (const field of ['sourceAnchor', 'targetAnchor'] as const) {
    const anchor = value[field]
    if (anchor === undefined) continue
    if (isAnchor(anchor)) anchors[field] = anchor
    // A bad anchor is dropped rather than fatal: an absent anchor is a legal
    // document that simply re-routes itself, so the arrow survives.
    else report(`connection ${id}: dropped an invalid ${field}`)
  }

  const style = sanitiseStyle(
    value.style,
    CONNECTION_STYLE_FIELDS,
    report,
    `connection ${id}`,
  )
  return {
    id,
    sourceId: value.sourceId,
    targetId: value.targetId,
    ...anchors,
    ...(style === undefined ? {} : { style }),
  }
}

/**
 * Rebuilds an order list so it names exactly the surviving ids, once each.
 *
 * Entries for elements that are gone are dropped, duplicates collapse, and
 * anything present in the map but missing from the list is appended. Appending
 * rather than refusing, because the alternative — dropping a block because its
 * *paint order* was corrupt — would destroy content over a rendering detail.
 */
function reconcileOrder(
  order: unknown,
  present: ReadonlySet<string>,
  report: (repair: string) => void,
  what: string,
): string[] {
  const listed = Array.isArray(order) ? order : []
  if (!Array.isArray(order)) report(`${what}Order was not an array; rebuilt it`)

  const out: string[] = []
  const seen = new Set<string>()
  for (const id of listed) {
    if (typeof id !== 'string' || !present.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }

  const dropped = listed.length - out.length
  if (dropped > 0) report(`${what}Order: dropped ${dropped} stale or duplicate entries`)

  let appended = 0
  for (const id of present) {
    if (seen.has(id)) continue
    out.push(id)
    appended += 1
  }
  if (appended > 0) report(`${what}Order: appended ${appended} unlisted ${what}`)

  return out
}

/**
 * Validates and repairs an already-migrated record.
 *
 * Separate from `loadDocument` so the migration chain and the invariants can
 * be tested — and can fail — independently.
 */
export function validateDocument(raw: unknown): LoadResult {
  if (!isPlainObject(raw))
    return { ok: false, reason: 'bad-shape', detail: 'not an object' }

  for (const key of DOCUMENT_KEYS) {
    const value = raw[key]
    const wantsArray = key.endsWith('Order')
    if (wantsArray ? !Array.isArray(value) : !isPlainObject(value)) {
      return {
        ok: false,
        reason: 'bad-shape',
        detail: `${key} is ${wantsArray ? 'not an array' : 'not an object'}`,
      }
    }
  }

  const repairs: string[] = []
  const report = (repair: string) => repairs.push(repair)

  /* Blocks first: everything else is defined in terms of which ones survive. */
  const blocks: Record<string, Block> = {}
  for (const [id, value] of Object.entries(raw.blocks as Record<string, unknown>)) {
    const block = readBlock(id, value, report)
    if (block) blocks[id] = block
    else report(`dropped malformed block ${id}`)
  }
  const liveBlocks = new Set(Object.keys(blocks))

  /* Connections: the orphan rule, which is the store's own cascade. */
  const connections: Record<string, Connection> = {}
  for (const [id, value] of Object.entries(raw.connections as Record<string, unknown>)) {
    const connection = readConnection(id, value, report)
    if (!connection) {
      report(`dropped malformed connection ${id}`)
      continue
    }
    if (!liveBlocks.has(connection.sourceId) || !liveBlocks.has(connection.targetId)) {
      report(`dropped connection ${id}, which pointed at a block that is not there`)
      continue
    }
    connections[id] = connection
  }

  /*
   * Groups: dead members pruned, duplicates within a group collapsed, a block
   * claimed by two groups left with the first that named it, and anything
   * below the minimum dissolved. Exactly `pruneGroups` plus `addGroup`'s
   * absorb rule, applied to a file instead of to a delete.
   */
  const groups: Record<string, Group> = {}
  const owner = new Map<string, string>()
  for (const [id, value] of Object.entries(raw.groups as Record<string, unknown>)) {
    if (!isPlainObject(value) || value.id !== id || !Array.isArray(value.blockIds)) {
      report(`dropped malformed group ${id}`)
      continue
    }

    const members: string[] = []
    for (const blockId of value.blockIds) {
      if (typeof blockId !== 'string') continue
      if (!liveBlocks.has(blockId)) {
        report(`group ${id}: dropped member ${blockId}, which is not a block`)
        continue
      }
      if (members.includes(blockId)) continue
      const claimed = owner.get(blockId)
      if (claimed !== undefined) {
        report(`group ${id}: dropped member ${blockId}, already in group ${claimed}`)
        continue
      }
      members.push(blockId)
    }

    if (members.length < MIN_GROUP_SIZE) {
      report(`dissolved group ${id}, left with ${members.length} members`)
      continue
    }
    for (const blockId of members) owner.set(blockId, id)
    groups[id] = { id, blockIds: members }
  }

  return {
    ok: true,
    document: {
      version: typeof raw.version === 'number' ? raw.version : 0,
      blocks,
      blockOrder: reconcileOrder(raw.blockOrder, liveBlocks, report, 'block'),
      connections,
      connectionOrder: reconcileOrder(
        raw.connectionOrder,
        new Set(Object.keys(connections)),
        report,
        'connection',
      ),
      groups,
      groupOrder: reconcileOrder(
        raw.groupOrder,
        new Set(Object.keys(groups)),
        report,
        'group',
      ),
    },
    repairs,
  }
}

/**
 * Migrate, then validate. The only entry point the app uses.
 *
 * In that order, because a migration is written against the shape of the
 * version it upgrades *from*, and validating first would mean validating a
 * version 1 document against version 2's rules.
 */
export function loadDocument(raw: unknown, options?: MigrateOptions): LoadResult {
  const migrated = migrateDocument(raw, options)
  if (!migrated.ok) return { ok: false, reason: migrated.reason }

  const validated = validateDocument(migrated.document)
  if (!validated.ok) return validated
  // The version the walk arrived at, not whatever the file happened to claim.
  return {
    ok: true,
    document: { ...validated.document, version: migrated.from + migrated.steps },
    repairs: validated.repairs,
  }
}
