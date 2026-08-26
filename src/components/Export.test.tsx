import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import App from '../App'
import { useHistoryStore } from '../history/historyStore'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_THEME } from '../theme/stylesheet'
import { useThemeStore } from '../theme/themeStore'
import { THEMES } from '../theme/tokens'
import { DEFAULT_VIEWPORT } from '../utils/coords'

/*
 * The export control as a user meets it.
 *
 * Downloading is intercepted rather than performed: jsdom has no
 * `URL.createObjectURL` and no navigation, so the anchor click is captured and
 * the blob read back as text. That is enough to assert *what* would be saved,
 * which is the part this file is about; whether the browser writes it to disk
 * is the browser's business.
 */

const CANVAS_BOX: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 1000,
  bottom: 800,
  width: 1000,
  height: 800,
  toJSON: () => ({}),
}

interface Saved {
  filename: string
  type: string
  text: string
}

let saved: Saved[] = []
let urls = 0

beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  saved = []
  urls = 0

  const blobs = new Map<string, Blob>()
  // jsdom implements neither of these; the download path is the one piece of
  // the exporter that only exists in a browser.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      urls += 1
      const url = `blob:flowcraft/${urls}`
      blobs.set(url, blob)
      return url
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      blobs.delete(url)
      urls -= 1
    },
  })

  // Capture the anchor click instead of letting jsdom try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href)
    if (!blob) throw new Error(`no blob behind ${this.href}`)
    saved.push({ filename: this.download, type: blob.type, text: '' })
    void blob.text().then((text) => {
      const entry = saved[saved.length - 1]
      if (entry) entry.text = text
    })
  })

  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: false,
  })
  useHistoryStore.getState().clear()
  useThemeStore.setState({ theme: DEFAULT_THEME })
})

afterEach(() => {
  // Restores the anchor-click spy installed above, without reading the method
  // off the prototype to do it.
  vi.restoreAllMocks()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

const store = () => useDiagramStore.getState()
const toggle = () => screen.getByTestId('export-toggle')

/** Two blocks and an arrow, straight into the store, history cleared. */
function seed(): void {
  act(() => {
    store().addBlock({
      id: 'a',
      type: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text: 'a',
    })
    store().addBlock({
      id: 'b',
      type: 'rect',
      x: 400,
      y: 0,
      width: 100,
      height: 60,
      text: 'b',
    })
    store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b', sourceAnchor: 'e' })
    useHistoryStore.getState().clear()
  })
}

const openMenu = () => {
  fireEvent.click(toggle())
  return screen.getByTestId('export-menu')
}

describe('the export button', () => {
  it('is disabled while there is nothing to export', () => {
    render(<App />)
    expect(toggle()).toBeDisabled()
    expect(toggle()).toHaveAttribute('title', expect.stringContaining('Draw something'))
  })

  it('comes alive once the diagram has something in it', () => {
    seed()
    render(<App />)
    expect(toggle()).toBeEnabled()
  })

  it('opens and closes a menu', () => {
    seed()
    render(<App />)
    expect(screen.queryByTestId('export-menu')).toBeNull()

    openMenu()
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle())
    expect(screen.queryByTestId('export-menu')).toBeNull()
  })

  it('closes on Escape without also clearing the selection', () => {
    // Two things answer to Escape here. Closing a menu must not cost the user
    // the selection they were about to style.
    seed()
    render(<App />)
    act(() => {
      store().select(['a', 'b'])
    })

    openMenu()
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('export-menu')).toBeNull()
    expect(store().selectedIds).toEqual(['a', 'b'])
  })

  it('closes on a click outside it', () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('export-menu')).toBeNull()
  })

  it('shows the size each option would produce', () => {
    seed()
    render(<App />)
    const menu = openMenu()
    // Blocks span 0..500 by 0..60, plus a 24-unit margin on each side.
    expect(menu).toHaveTextContent('548×108')
    expect(menu).toHaveTextContent('1096×216')
  })
})

describe('saving an SVG', () => {
  it('writes the diagram out as an SVG file', async () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))

    await waitFor(() => {
      expect(saved[0]?.text.length).toBeGreaterThan(0)
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.filename).toMatch(/^flowcraft-\d{4}-\d{2}-\d{2}-\d{4}\.svg$/)
    expect(saved[0]?.type).toContain('image/svg+xml')
    expect(saved[0]?.text).toContain('<svg')
    expect(saved[0]?.text).toContain('>a<')
  })

  it('closes the menu once the file is on its way', () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))
    expect(screen.queryByTestId('export-menu')).toBeNull()
  })

  it('exports the theme that is on', async () => {
    seed()
    render(<App />)
    fireEvent.click(screen.getByTestId('theme-toggle'))

    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))
    await waitFor(() => {
      expect(saved[0]?.text.length).toBeGreaterThan(0)
    })
    expect(saved[0]?.text).toContain(THEMES.light.blockFill)
    expect(saved[0]?.text).not.toContain(THEMES.dark.blockFill)
  })

  it('drops the background when transparency is asked for', async () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-transparent'))
    fireEvent.click(screen.getByTestId('export-svg'))

    await waitFor(() => {
      expect(saved[0]?.text.length).toBeGreaterThan(0)
    })
    expect(saved[0]?.text).not.toContain(`fill="${THEMES.dark.surface}"`)
  })

  it('paints an opaque background by default', async () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))

    await waitFor(() => {
      expect(saved[0]?.text.length).toBeGreaterThan(0)
    })
    expect(saved[0]?.text).toContain(`fill="${THEMES.dark.surface}"`)
  })

  it('lets go of the blob URL it made', async () => {
    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))

    // Revocation is deferred past the click, so a real timer has to turn over.
    await waitFor(
      () => {
        expect(urls).toBe(0)
      },
      { timeout: 1000 },
    )
  })
})

describe('exporting is not an edit', () => {
  it('creates no history entry', async () => {
    // The property that would be quietly broken by a later "remember my export
    // settings" feature routing a store action through here.
    seed()
    render(<App />)
    expect(useHistoryStore.getState().undoStack).toHaveLength(0)

    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))
    await waitFor(() => {
      expect(saved).toHaveLength(1)
    })

    expect(useHistoryStore.getState().undoStack).toHaveLength(0)
    expect(useHistoryStore.getState().redoStack).toHaveLength(0)
  })

  it('leaves the document exactly as it was', async () => {
    seed()
    render(<App />)
    const before = structuredClone({
      blocks: store().blocks,
      blockOrder: store().blockOrder,
      connections: store().connections,
      connectionOrder: store().connectionOrder,
      groups: store().groups,
      groupOrder: store().groupOrder,
    })

    openMenu()
    fireEvent.click(screen.getByTestId('export-transparent'))
    fireEvent.click(screen.getByTestId('export-svg'))
    await waitFor(() => {
      expect(saved).toHaveLength(1)
    })

    expect({
      blocks: store().blocks,
      blockOrder: store().blockOrder,
      connections: store().connections,
      connectionOrder: store().connectionOrder,
      groups: store().groups,
      groupOrder: store().groupOrder,
    }).toEqual(before)
  })

  it('leaves the selection and the tool alone', () => {
    seed()
    render(<App />)
    act(() => {
      store().select('a')
      store().setTool('rect')
    })

    openMenu()
    fireEvent.click(screen.getByTestId('export-svg'))

    expect(store().selectedIds).toEqual(['a'])
    expect(store().tool).toBe('rect')
  })
})

describe('when the PNG cannot be made', () => {
  it('says so instead of saving a blank image', async () => {
    // jsdom cannot rasterise, which is the real path here — and the same path
    // a browser with a disabled canvas would take.
    const stub = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    seed()
    render(<App />)
    openMenu()
    fireEvent.click(screen.getByTestId('export-png-1x'))

    await waitFor(() => {
      expect(screen.getByTestId('export-error')).toBeInTheDocument()
    })
    expect(saved).toHaveLength(0)
    // The menu stays open, so the message is where the user is looking.
    expect(screen.getByTestId('export-menu')).toBeInTheDocument()
    stub.mockRestore()
  })
})
