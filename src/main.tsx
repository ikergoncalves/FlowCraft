import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installThemeStyles } from './theme/stylesheet'
import { initialTheme, useThemeStore } from './theme/themeStore'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root is missing from index.html')
}

/*
 * Theme before render, deliberately.
 *
 * The generated custom properties have to be in the document before the first
 * paint of anything that uses them, or the opening frame draws with unresolved
 * `var()` references — which in SVG means black shapes on a transparent
 * canvas, not merely the wrong palette.
 *
 * The stored preference is not consulted here: reading it is asynchronous
 * (IndexedDB), so opening on the platform's `prefers-color-scheme` and letting
 * the restore correct it a beat later is the only order that has no wrong
 * frame in it. See `usePersistence`.
 */
installThemeStyles()
useThemeStore.getState().setTheme(initialTheme(undefined))

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
