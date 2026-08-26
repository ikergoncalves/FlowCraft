import type { Block, Connection, Group } from '../types'

/**
 * The persisted shape of a diagram, and the two projections around it.
 *
 * **The format mirrors the store's own document slice**, maps and order lists
 * and all, rather than flattening to arrays in paint order. Arrays would be
 * the tidier file — an array cannot disagree with itself about ordering the
 * way a map plus an order list can — and that is exactly the argument that was
 * weighed and lost:
 *
 *  - Serialising to arrays means *reconstructing* the maps and the order lists
 *    on every load. That is a transformation performed on the user's document
 *    every single time the app opens, and a transformation is a place a bug
 *    lives. Mirroring makes `toDocument`/`fromDocument` a rename and nothing
 *    more, so the round trip is the identity by construction rather than by
 *    argument.
 *  - The redundancy is real, and it is the reason the validator exists. A
 *    document is external data whatever shape it has: the array form would
 *    still need "no duplicate ids", which is the same check wearing a
 *    different name. Keeping the store's shape means the persisted document
 *    can be handed straight to the same invariant assertions that already
 *    guard the in-memory one.
 *
 * The version field is present from the very first save. There is nothing to
 * migrate yet, and that is precisely when it has to be written: a document
 * saved without one can never be told apart from a document saved by a version
 * that had not thought about versions.
 */
export const DOCUMENT_VERSION = 1

/** The parts of the diagram store that are the document. */
export interface DocumentSlice {
  blocks: Record<string, Block>
  blockOrder: string[]
  connections: Record<string, Connection>
  connectionOrder: string[]
  groups: Record<string, Group>
  groupOrder: string[]
}

/** A document as it is written to storage. */
export interface DiagramDocument extends DocumentSlice {
  version: number
}

/** The keys of `DocumentSlice`, so nothing has to list them twice. */
export const DOCUMENT_KEYS = [
  'blocks',
  'blockOrder',
  'connections',
  'connectionOrder',
  'groups',
  'groupOrder',
] as const

/**
 * Copies the document out of the store.
 *
 * Deep, via `structuredClone`, for the same reason history commands copy what
 * they capture: the store replaces these objects wholesale on every edit, and
 * a save that held references would be racing whatever the user typed next.
 */
export function toDocument(state: DocumentSlice): DiagramDocument {
  return {
    version: DOCUMENT_VERSION,
    blocks: structuredClone(state.blocks),
    blockOrder: [...state.blockOrder],
    connections: structuredClone(state.connections),
    connectionOrder: [...state.connectionOrder],
    groups: structuredClone(state.groups),
    groupOrder: [...state.groupOrder],
  }
}

/**
 * The inverse: a document as a store slice, with the version dropped.
 *
 * The version deliberately does not survive into the store. It describes the
 * *file*, not the diagram, and a copy of it sitting in memory would be one
 * more thing for a later save to get wrong — `toDocument` stamps the current
 * version every time, which is the only correct answer for something the
 * running program has just produced.
 */
export function fromDocument(document: DiagramDocument): DocumentSlice {
  return {
    blocks: structuredClone(document.blocks),
    blockOrder: [...document.blockOrder],
    connections: structuredClone(document.connections),
    connectionOrder: [...document.connectionOrder],
    groups: structuredClone(document.groups),
    groupOrder: [...document.groupOrder],
  }
}

/** An empty document, which is what a rejected load falls back to. */
export function emptyDocument(): DiagramDocument {
  return {
    version: DOCUMENT_VERSION,
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    groups: {},
    groupOrder: [],
  }
}

/** Whether a document holds nothing at all. */
export function isEmptyDocument(document: DocumentSlice): boolean {
  return document.blockOrder.length === 0 && document.connectionOrder.length === 0
}
