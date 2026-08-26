import { describe, expect, it, vi } from 'vitest'
import { diagramFilename } from './download'
import { PNG_SCALES, pngSize, renderPng } from './png'
import type { SvgExport } from './svg'

const svg = (width: number, height: number): SvgExport => ({
  markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" />`,
  width,
  height,
})

/*
 * What jsdom can say about rasterising: the arithmetic, and the failure paths.
 *
 * It cannot say whether the picture is right. jsdom ships no canvas at all —
 * `getContext('2d')` returns null and there is no image decoder behind
 * `new Image()` — so a test that claimed to check pixels here would be
 * checking a stub. The real question, "does the PNG have plausible dimensions
 * and is it not a blank rectangle", is asked in `verify-browser.mjs` against a
 * Chrome that actually rasterises.
 */

describe('the offered scales', () => {
  it('offers at least 1x and 2x', () => {
    expect(PNG_SCALES).toContain(1)
    expect(PNG_SCALES).toContain(2)
  })
})

describe('pngSize', () => {
  it('is the SVG size at 1x', () => {
    expect(pngSize(svg(300, 200), 1)).toEqual({ width: 300, height: 200 })
  })

  it('doubles at 2x', () => {
    expect(pngSize(svg(300, 200), 2)).toEqual({ width: 600, height: 400 })
  })

  it('rounds to whole pixels', () => {
    // A canvas dimension is an integer; a fractional one is silently floored,
    // which loses a column of the drawing.
    expect(pngSize(svg(148.5, 108.5), 1)).toEqual({ width: 149, height: 109 })
    expect(pngSize(svg(10.2, 10.2), 2)).toEqual({ width: 20, height: 20 })
  })

  it('never produces a zero-sized canvas', () => {
    // `canvas.width = 0` throws on `drawImage` in some browsers and produces a
    // corrupt file in others.
    expect(pngSize(svg(0, 0), 1)).toEqual({ width: 1, height: 1 })
    expect(pngSize(svg(0.1, 0.1), 1)).toEqual({ width: 1, height: 1 })
  })
})

describe('renderPng under a browser that cannot rasterise', () => {
  /*
   * jsdom's own `getContext` returns null *and* logs a "not implemented"
   * notice through the virtual console. Stubbing it keeps the run quiet and
   * says out loud which condition is being exercised, rather than relying on
   * a diagnostic that a future jsdom might change.
   */
  const withoutCanvas = () =>
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

  it('rejects with a plain message rather than a blank image', async () => {
    const stub = withoutCanvas()
    // jsdom is exactly that browser, so this is the real path here. A silently
    // blank PNG is the failure this guards: the user finds out about it after
    // they have sent it to someone.
    await expect(
      renderPng(svg(100, 100), { scale: 1, background: null }),
    ).rejects.toThrow(/cannot rasterise|could not be rendered/)
    stub.mockRestore()
  })

  it('rejects rather than resolving with something empty', async () => {
    const stub = withoutCanvas()
    const result = await renderPng(svg(100, 100), {
      scale: 2,
      background: '#ffffff',
    }).then(
      () => 'resolved',
      () => 'rejected',
    )
    expect(result).toBe('rejected')
    stub.mockRestore()
  })
})

describe('diagramFilename', () => {
  it('stamps the local date and time', () => {
    const at = new Date(2026, 7, 26, 14, 32)
    expect(diagramFilename('svg', at)).toBe('flowcraft-2026-08-26-1432.svg')
  })

  it('pads, so the names sort as text', () => {
    const at = new Date(2026, 0, 2, 3, 4)
    expect(diagramFilename('png', at)).toBe('flowcraft-2026-01-02-0304.png')
  })

  it('takes whatever extension it is given', () => {
    const at = new Date(2026, 7, 26, 14, 32)
    expect(diagramFilename('png', at).endsWith('.png')).toBe(true)
    expect(diagramFilename('svg', at).endsWith('.svg')).toBe(true)
  })

  it('changes between exports a minute apart, so nothing is overwritten', () => {
    expect(diagramFilename('svg', new Date(2026, 7, 26, 14, 32))).not.toBe(
      diagramFilename('svg', new Date(2026, 7, 26, 14, 33)),
    )
  })

  it('defaults to now', () => {
    const now = vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2030)
    expect(diagramFilename('svg')).toContain('2030')
    now.mockRestore()
  })
})
