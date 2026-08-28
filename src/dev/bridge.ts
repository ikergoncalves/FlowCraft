import { useHistoryStore } from '../history/historyStore'
import { toDocument } from '../persistence/document'
import { useDiagramStore } from '../store/diagramStore'
import { makeBigDiagram, type BigDiagramOptions } from './bigDiagram'

/**
 * A narrow debug handle on `window`, for harnesses that have to get a large
 * document into the editor without clicking it into existence.
 *
 * **Why it exists at all.** Every check written before this phase drives the
 * app the way a user does, and that is still the rule — the E2E specs click,
 * drag and type. But "how long does the first paint of 500 blocks take?"
 * cannot be asked that way: creating the diagram by hand would dominate the
 * measurement and take minutes per run. This is the one door that skips the UI,
 * and it is deliberately not a general one — it seeds and it reports, and it
 * cannot edit.
 *
 * **Why it ships in the production bundle.** Because the numbers that matter
 * come from the build the user actually runs. React's development build is
 * roughly twice as slow and re-renders twice under StrictMode, so measuring
 * the dev server would be measuring the wrong program. Gating this on
 * `import.meta.env.DEV` would have made the production deploy unmeasurable,
 * which is precisely the thing worth measuring.
 *
 * **Why that is safe.** It is inert until called: nothing here runs on load,
 * no URL parameter reaches it, and no part of the app reads it. Someone who
 * opens the console and seeds a thousand blocks over their own diagram has
 * done that on purpose, and it costs one Ctrl+Z less than it costs a
 * `localStorage` edit. The alternative — a second build flavour, built and
 * deployed separately, that the deploy pipeline would have to keep honest —
 * buys nothing for a static single-page app with no secrets in it.
 */

export interface FlowCraftDebugBridge {
  /**
   * Replaces the document with a generated one and returns what it made.
   *
   * Goes through `replaceDocument`, so it is the same door a restore from
   * storage comes through, and it clears the history for the same reason a
   * restore does: the stack that preceded it describes a document that is gone.
   */
  seed: (options: BigDiagramOptions) => { blocks: number; connections: number }
  /** How much of the document exists, whatever is currently on screen. */
  count: () => { blocks: number; connections: number; groups: number }
  /** How much of it is actually in the DOM. The culling probe. */
  rendered: () => { blocks: number; connections: number }
  /** Moves the camera. Culling is a function of the viewport, so probes need it. */
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void
  /**
   * Milliseconds for one `toDocument`, averaged over `runs`.
   *
   * The auto-save deep-clones the whole document on every write, and Phase 6
   * left that noted as a debt without a number attached. This is the number:
   * it either fits comfortably inside the 600ms debounce or it does not.
   */
  snapshotCost: (runs?: number) => number
}

export const BRIDGE_KEY = '__flowcraft'

export function createBridge(): FlowCraftDebugBridge {
  return {
    seed: (options) => {
      const document = makeBigDiagram(options)
      useDiagramStore.getState().replaceDocument(document)
      useHistoryStore.getState().clear()
      return {
        blocks: document.blockOrder.length,
        connections: document.connectionOrder.length,
      }
    },
    count: () => {
      const state = useDiagramStore.getState()
      return {
        blocks: state.blockOrder.length,
        connections: state.connectionOrder.length,
        groups: state.groupOrder.length,
      }
    },
    rendered: () => ({
      blocks: globalThis.document.querySelectorAll('[data-block-id]').length,
      connections: globalThis.document.querySelectorAll('[data-connection-id]').length,
    }),
    setViewport: (viewport) => {
      useDiagramStore.getState().setViewport(viewport)
    },
    snapshotCost: (runs = 20) => {
      const state = useDiagramStore.getState()
      const start = performance.now()
      for (let i = 0; i < runs; i += 1) toDocument(state)
      return (performance.now() - start) / runs
    },
  }
}

/** Hangs the bridge off `window`. Called once, from `main.tsx`. */
export function installBridge(view: Window & { [BRIDGE_KEY]?: FlowCraftDebugBridge }) {
  view[BRIDGE_KEY] = createBridge()
}
