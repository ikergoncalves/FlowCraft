import { DOCUMENT_VERSION } from './document'

/**
 * The version chain, empty today and load-bearing anyway.
 *
 * There is exactly one document version in existence, so there is nothing to
 * migrate and every migration below is hypothetical. Building the mechanism
 * now rather than when it is first needed is a deliberate trade: the day a
 * version 2 exists, every document already on disk is a version 1, and a
 * migration path invented at that point has to be right first time against
 * data nobody can reproduce. A path that has been in place, exercised and
 * tested from the beginning only has to be *populated*.
 *
 * `MIGRATIONS[n]` upgrades a version-`n` document to version `n + 1`. The
 * chain is walked one step at a time rather than jumping, so a version 1
 * document arriving at version 4 runs 1→2→3→4 and each step only ever has to
 * know about its immediate neighbour.
 */

/** One step of the chain. Takes and returns a raw record, not a typed one. */
export type Migration = (document: Record<string, unknown>) => Record<string, unknown>

export const MIGRATIONS: Record<number, Migration> = {}

/** Why a document could not be brought to the current version. */
export type MigrationFailure =
  /** Not an object at all — `null`, an array, a number, a string. */
  | 'not-an-object'
  /** No usable `version` field, so there is no telling what shape it is. */
  | 'no-version'
  /**
   * Saved by a *newer* build than this one. Refused rather than guessed at:
   * a forward migration cannot be written by the version that came first, and
   * loading a newer document with older rules would silently drop whatever
   * fields this build has never heard of — then save the loss back over the
   * original on the next edit.
   */
  | 'from-the-future'
  /** A step in the chain is missing, so the walk cannot continue. */
  | 'no-migration'
  /** A registered migration threw. */
  | 'migration-failed'

export type MigrationResult =
  | { ok: true; document: Record<string, unknown>; from: number; steps: number }
  | { ok: false; reason: MigrationFailure; version?: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface MigrateOptions {
  /** Injectable so a test can register a pretend 1 -> 2 step. */
  migrations?: Record<number, Migration>
  /** Injectable so a test can pretend the current version is higher. */
  target?: number
}

/**
 * Walks a raw record up to `target`, or explains why it cannot.
 *
 * Everything here works on `Record<string, unknown>` rather than on a typed
 * document, and that is the point: at this stage nothing is known about the
 * value beyond "it claims to be version N". Typing it would be claiming to
 * have validated it, which is the next step's job and not this one's.
 */
export function migrateDocument(
  raw: unknown,
  { migrations = MIGRATIONS, target = DOCUMENT_VERSION }: MigrateOptions = {},
): MigrationResult {
  if (!isPlainObject(raw)) return { ok: false, reason: 'not-an-object' }

  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'no-version' }
  }
  if (version > target) return { ok: false, reason: 'from-the-future', version }

  let document = raw
  let steps = 0
  for (let at = version; at < target; at += 1) {
    const step = migrations[at]
    if (!step) return { ok: false, reason: 'no-migration', version: at }

    let next: unknown
    try {
      next = step(document)
    } catch {
      return { ok: false, reason: 'migration-failed', version: at }
    }
    if (!isPlainObject(next))
      return { ok: false, reason: 'migration-failed', version: at }

    // The step's own idea of the version is not trusted: a migration that
    // forgot to bump it would loop, and one that bumped it twice would skip a
    // step. The walk owns the counter.
    document = { ...next, version: at + 1 }
    steps += 1
  }

  return { ok: true, document, from: version, steps }
}
