import { useDiagramStore } from '../store/diagramStore'
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

export function Toolbar() {
  const tool = useDiagramStore((state) => state.tool)
  const setTool = useDiagramStore((state) => state.setTool)

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
    </div>
  )
}
