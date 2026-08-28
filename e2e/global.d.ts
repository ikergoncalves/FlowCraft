import type { FlowCraftDebugBridge } from '../src/dev/bridge'

/**
 * The debug bridge, as the specs see it.
 *
 * Typed from the app's own declaration rather than restated, so a change to
 * the bridge breaks the specs at compile time instead of at three in the
 * morning in CI.
 */
declare global {
  interface Window {
    __flowcraft: FlowCraftDebugBridge
  }
}

export {}
