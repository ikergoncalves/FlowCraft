import { redoLabel, undoLabel, useHistoryStore } from '../history/historyStore'
import { useDiagramStore } from '../store/diagramStore'
import { useThemeStore } from '../theme/themeStore'
import { ExportMenu } from './ExportMenu'
import { StorageStatus } from './StorageStatus'
import type { Tool } from '../types'

interface ToolSpec {
  tool: Tool
  label: string
  shortcut: string
}

const TOOLS: ToolSpec[] = [
  { tool: 'select', label: 'Select', shortcut: 'V' },
  { tool: 'rect', label: 'Rectangle', shortcut: 'R' },
  { tool: 'text', label: 'Text', shortcut: 'T' },
]

/**
 * `"Undo: Move 3 blocks"`, or plain `"Undo"` when there is nothing to undo.
 *
 * The label is the command's own, so the button and the history can never
 * disagree about what the next press will do.
 */
function actionTitle(verb: string, label: string | null): string {
  return label === null ? verb : `${verb}: ${label}`
}

export function Toolbar() {
  const tool = useDiagramStore((state) => state.tool)
  const setTool = useDiagramStore((state) => state.setTool)
  const snapToGrid = useDiagramStore((state) => state.snapToGrid)
  const toggleSnapToGrid = useDiagramStore((state) => state.toggleSnapToGrid)

  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)

  const undo = useHistoryStore((state) => state.undo)
  const redo = useHistoryStore((state) => state.redo)
  const nextUndo = useHistoryStore(undoLabel)
  const nextRedo = useHistoryStore(redoLabel)

  const otherTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <span className="toolbar__brand">FlowCraft</span>
      <div className="toolbar__group">
        {TOOLS.map((spec) => (
          <button
            key={spec.tool}
            type="button"
            className="toolbar__button"
            aria-pressed={tool === spec.tool}
            title={`${spec.label} (${spec.shortcut})`}
            onClick={() => {
              setTool(spec.tool)
            }}
          >
            {spec.label}
            <kbd className="toolbar__kbd">{spec.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        {/* Genuinely `disabled`, not just dimmed: a button that looks dead and
            still fires is worse than either. */}
        <button
          type="button"
          className="toolbar__button"
          data-testid="undo"
          disabled={nextUndo === null}
          title={actionTitle('Undo', nextUndo)}
          aria-label={actionTitle('Undo', nextUndo)}
          onClick={undo}
        >
          Undo
          <kbd className="toolbar__kbd">Ctrl Z</kbd>
        </button>
        <button
          type="button"
          className="toolbar__button"
          data-testid="redo"
          disabled={nextRedo === null}
          title={actionTitle('Redo', nextRedo)}
          aria-label={actionTitle('Redo', nextRedo)}
          onClick={redo}
        >
          Redo
          <kbd className="toolbar__kbd">Ctrl ⇧ Z</kbd>
        </button>
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="toolbar__button"
          aria-pressed={snapToGrid}
          title="Snap to grid (G) — hold Alt during a gesture to invert"
          onClick={toggleSnapToGrid}
        >
          Snap
          <kbd className="toolbar__kbd">G</kbd>
        </button>

        {/* Labelled with the theme it switches *to*, not the one in force: a
            toggle that names its current state reads as a claim, and the user
            can already see which theme they are looking at. */}
        <button
          type="button"
          className="toolbar__button"
          data-testid="theme-toggle"
          data-theme-target={otherTheme}
          title={`Switch to the ${otherTheme} theme (L)`}
          aria-label={`Switch to the ${otherTheme} theme`}
          onClick={toggleTheme}
        >
          {otherTheme === 'light' ? 'Light' : 'Dark'}
          <kbd className="toolbar__kbd">L</kbd>
        </button>
      </div>

      <ExportMenu />

      <StorageStatus />
    </div>
  )
}
