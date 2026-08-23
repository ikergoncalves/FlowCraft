import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'

export default function App() {
  useEditorShortcuts()

  return (
    <div className="app">
      <Toolbar />
      <Canvas />
    </div>
  )
}
