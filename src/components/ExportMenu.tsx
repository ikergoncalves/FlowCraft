import { useEffect, useId, useRef, useState } from 'react'
import { diagramFilename, downloadBlob, downloadText } from '../export/download'
import { PNG_SCALES, pngSize, renderPng, type PngScale } from '../export/png'
import { exportSvg } from '../export/svg'
import { useDiagramStore } from '../store/diagramStore'
import { useThemeStore } from '../theme/themeStore'
import { THEMES } from '../theme/tokens'

/**
 * The export control.
 *
 * **Nothing here touches the history.** Exporting reads the document and
 * writes a file; it is not an edit, so there is no command, no entry and
 * nothing to undo. That is not enforced by a rule anywhere — it falls out of
 * the fact that `exportSvg` is a pure function of the document and every path
 * below calls it and then a download. A test asserts it anyway, because it is
 * the sort of thing a later "remember the last export settings" feature could
 * quietly break by routing a store action through here.
 *
 * A popover rather than three toolbar buttons: PNG needs a scale and both need
 * a background choice, and five controls in the toolbar for something used
 * once a session is the wrong trade. Closed on Escape and on a click outside,
 * which is the whole of what a menu this small owes anyone.
 */
export function ExportMenu() {
  const blockOrder = useDiagramStore((state) => state.blockOrder)
  const theme = useThemeStore((state) => state.theme)

  const [open, setOpen] = useState(false)
  const [transparent, setTransparent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const backgroundId = useId()

  // An empty diagram has nothing to export — see `exportSvg` on why refusing
  // beats writing a blank file.
  const empty = blockOrder.length === 0

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Claimed in the capture phase, before the editor's own Escape handler
      // clears the selection: closing a menu should not also lose your work
      // in progress.
      event.stopPropagation()
      setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const build = () => {
    // Read the document at the moment of export, not at render: the store is
    // the source of truth and this component subscribes only to the id list.
    const state = useDiagramStore.getState()
    return exportSvg(state, {
      theme,
      background: transparent ? null : THEMES[theme].surface,
    })
  }

  const saveSvg = () => {
    setError(null)
    const svg = build()
    if (!svg) {
      setError('There is nothing to export yet.')
      return
    }
    downloadText(svg.markup, diagramFilename('svg'), 'image/svg+xml')
    setOpen(false)
  }

  const savePng = async (scale: PngScale) => {
    setError(null)
    const svg = build()
    if (!svg) {
      setError('There is nothing to export yet.')
      return
    }

    setBusy(true)
    try {
      const blob = await renderPng(svg, {
        scale,
        // Transparency is offered, but the default is opaque — see `png.ts`.
        background: transparent ? null : THEMES[theme].surface,
      })
      downloadBlob(blob, diagramFilename('png'))
      setOpen(false)
    } catch (failure) {
      // Better a message than a silently wrong picture: a PNG that is the
      // wrong image is found out after it has been sent to someone.
      setError(failure instanceof Error ? failure.message : 'The PNG could not be made')
    } finally {
      setBusy(false)
    }
  }

  const preview = open && !empty ? build() : null

  return (
    <div className="toolbar__group export" ref={containerRef}>
      <button
        type="button"
        className="toolbar__button"
        data-testid="export-toggle"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={empty}
        title={empty ? 'Draw something to export' : 'Export the diagram'}
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        Export
      </button>

      {open && (
        <div className="export__menu" data-testid="export-menu" role="menu">
          <button
            type="button"
            className="export__item"
            data-testid="export-svg"
            role="menuitem"
            onClick={saveSvg}
          >
            SVG
            <span className="export__hint">
              {preview ? `${preview.width}×${preview.height}` : ''}
            </span>
          </button>

          {PNG_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className="export__item"
              data-testid={`export-png-${scale}x`}
              role="menuitem"
              disabled={busy}
              onClick={() => {
                void savePng(scale)
              }}
            >
              {`PNG ${scale}×`}
              <span className="export__hint">
                {preview
                  ? (() => {
                      const size = pngSize(preview, scale)
                      return `${size.width}×${size.height}`
                    })()
                  : ''}
              </span>
            </button>
          ))}

          <label className="export__option" htmlFor={backgroundId}>
            <input
              id={backgroundId}
              type="checkbox"
              className="properties__check"
              data-testid="export-transparent"
              checked={transparent}
              onChange={(event) => {
                setTransparent(event.target.checked)
              }}
            />
            Transparent background
          </label>

          {error && (
            <p className="export__error" role="alert" data-testid="export-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
