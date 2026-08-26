import { create } from 'zustand'
import { applyTheme, DEFAULT_THEME } from './stylesheet'
import { isThemeName, type ThemeName } from './tokens'

/**
 * The active theme.
 *
 * A store of its own rather than a field on `useDiagramStore`, because the
 * theme is not part of the document: it is not exported, it is not undoable,
 * and two people opening the same diagram may reasonably see it in different
 * colours. Keeping it separate is also what stops a theme switch from waking
 * every subscriber of the diagram store — and, in Phase 6's terms, what keeps
 * the auto-save able to tell "the document changed" from "the user turned the
 * lights on", which is the whole difference between saving and not saving.
 *
 * `setTheme` writes to the DOM as well as to the store. That is a deliberate
 * side effect in an action: the attribute on `<html>` *is* the theme as far as
 * every painted pixel is concerned, and a store value that could be out of
 * step with it would be a second source of truth for the one fact this module
 * exists to own. Every way in — the toolbar, the shortcut, the restore from
 * storage — therefore lands the same way.
 */
export interface ThemeState {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  /** Dark to light and back; there are only two. */
  toggleTheme: () => void
}

/**
 * The theme the platform asks for, or the default when it has no opinion.
 *
 * Guarded because jsdom implements no `matchMedia` at all, and a first visit
 * in a test environment must not throw on the way to a perfectly good default.
 */
export function preferredTheme(view: Window | undefined = globalThis.window): ThemeName {
  if (typeof view?.matchMedia !== 'function') return DEFAULT_THEME
  return view.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : DEFAULT_THEME
}

/**
 * The theme to open with: the stored choice if there is a usable one, else
 * whatever the platform prefers.
 *
 * Takes the stored value as `unknown` on purpose — it comes out of storage,
 * which is to say from outside the program, and a persisted `"dracula"` from
 * some future version must land on the default rather than on an attribute
 * nothing has rules for.
 */
export function initialTheme(stored: unknown, view?: Window): ThemeName {
  return isThemeName(stored) ? stored : preferredTheme(view)
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: DEFAULT_THEME,

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  },
}))
