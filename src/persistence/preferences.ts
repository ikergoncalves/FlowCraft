import { DEFAULT_THEME } from '../theme/stylesheet'
import { isThemeName, type ThemeName } from '../theme/tokens'
import type { Viewport } from '../types'
import { clampZoom, DEFAULT_VIEWPORT } from '../utils/coords'

/**
 * UI preferences, stored apart from the document and on purpose.
 *
 * The split is about lifetime and ownership, not about size. A diagram is
 * *content*: it is what gets exported, what a second person would want if the
 * file were handed over, and what must never be lost. A viewport is where one
 * person's camera happened to be on one machine — sending it along with a
 * diagram would be shipping someone's scroll position, and the SVG export
 * ignores it for exactly that reason.
 *
 * Keeping them in separate records means each can be dropped without the
 * other: a preferences record wedged at zoom 4 in an empty corner of the world
 * can be cleared without touching a single block, and a rejected document does
 * not cost the user their theme.
 *
 * What is here and why:
 *
 *  - **theme** — a choice the user made explicitly, and one that would be
 *    jarring to have to make again on every reload.
 *  - **snapToGrid** — the same: a working preference, toggled rarely, annoying
 *    to reset.
 *  - **viewport** — restored because reopening a large diagram scrolled back
 *    to the origin means hunting for your own work. Clamped on the way in,
 *    because a corrupt zoom is the one field here that can make the editor
 *    look broken.
 *
 * What is deliberately *not* here: the active tool, which is one keypress and
 * whose restoration would have the editor open ready to create a block; the
 * selection, which points at blocks the user has long forgotten choosing; the
 * clipboard, which Phase 4 scoped to a session; and the undo history — see
 * `session.ts`.
 */
export const PREFERENCES_VERSION = 1

export interface Preferences {
  version: number
  theme: ThemeName
  snapToGrid: boolean
  viewport: Viewport
}

export function defaultPreferences(): Preferences {
  return {
    version: PREFERENCES_VERSION,
    theme: DEFAULT_THEME,
    snapToGrid: true,
    viewport: { ...DEFAULT_VIEWPORT },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Reads preferences, field by field, and never fails.
 *
 * The opposite policy to the document's, and for a reason rather than out of
 * inconsistency: every field here has an obvious right answer when it is
 * missing, so there is nothing to be gained by refusing the record and quite a
 * lot to lose — a single bad `snapToGrid` would otherwise cost the user their
 * theme as well. A document has no such default. There is no obvious diagram
 * to fall back to, which is why that one is rejected whole.
 *
 * Two consequences fall out. An unknown `version` is not fatal: reading
 * field-wise means a record from any version yields whatever it has in common
 * with this one. And a stored theme naming something this build has never
 * heard of lands on the default rather than on an attribute with no rules.
 */
export function readPreferences(raw: unknown): Preferences {
  const defaults = defaultPreferences()
  if (!isPlainObject(raw)) return defaults

  const viewport = isPlainObject(raw.viewport) ? raw.viewport : {}
  return {
    version: PREFERENCES_VERSION,
    theme: isThemeName(raw.theme) ? raw.theme : defaults.theme,
    snapToGrid:
      typeof raw.snapToGrid === 'boolean' ? raw.snapToGrid : defaults.snapToGrid,
    viewport: {
      x: finiteOr(viewport.x, defaults.viewport.x),
      y: finiteOr(viewport.y, defaults.viewport.y),
      // Clamped rather than defaulted: a zoom of 900 is a real number that a
      // user could conceivably have reached through a corrupt write, and
      // pinning it to the legal range keeps the diagram findable.
      zoom: clampZoom(finiteOr(viewport.zoom, defaults.viewport.zoom)),
    },
  }
}

/** The record to write, from the live values. */
export function toPreferences(
  theme: ThemeName,
  snapToGrid: boolean,
  viewport: Viewport,
): Preferences {
  return { version: PREFERENCES_VERSION, theme, snapToGrid, viewport: { ...viewport } }
}
