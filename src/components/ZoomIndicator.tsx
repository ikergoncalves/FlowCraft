import { useDiagramStore } from '../store/diagramStore'

export function ZoomIndicator() {
  const zoom = useDiagramStore((state) => state.viewport.zoom)
  const resetView = useDiagramStore((state) => state.resetView)

  return (
    <div className="zoom-indicator">
      <span className="zoom-indicator__value" data-testid="zoom-value">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        className="zoom-indicator__reset"
        title="Reset view (0)"
        onClick={resetView}
      >
        Reset view
      </button>
    </div>
  )
}
