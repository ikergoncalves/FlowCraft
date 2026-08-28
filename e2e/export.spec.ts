import { expect, test } from '@playwright/test'
import { downloadBytes, downloadFrom, Editor } from './editor'

/**
 * Export, taken from the download rather than from the exporter.
 *
 * The CDP harness this replaces reached into the dev server's module graph and
 * called `exportSvg` and `renderPng` directly. That was the closest it could
 * get, and it had two costs: the specifier only resolves while Vite is serving
 * source, so the check could never run against a built bundle or a deployed
 * site; and it skipped the download itself, which is the part of the feature
 * the user actually touches. Catching the file is strictly more end-to-end,
 * and it is what lets these same checks run against production.
 *
 * The SVG is otherwise a pure function of the document and is covered
 * exhaustively in `src/export/svg.test.ts`. What cannot be covered there is
 * rasterising, because jsdom ships no canvas and no image decoder — and the
 * failure mode is the nastiest in the repository: a canvas that fails to draw
 * still hands back a perfectly valid, correctly sized, entirely blank PNG.
 * Nothing short of reading the pixels can tell that from a picture.
 */

/** Two blocks and an arrow, so the export has a marker to carry. */
async function buildDiagram(editor: Editor) {
  const source = await editor.createBlockAt(260, 200)
  const target = await editor.createBlockAt(640, 380)
  await editor.connect(source.id, target.id)
  expect(await editor.connectionIds()).toHaveLength(1)
}

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

test('the export button is dead with nothing to export', async ({ page }) => {
  await expect(page.getByTestId('export-toggle')).toBeDisabled()
})

test('the menu floats over the canvas rather than pushing it down', async ({ page }) => {
  const editor = new Editor(page)
  await buildDiagram(editor)

  const canvasTopBefore = (await editor.canvasBox()).y
  const toggle = page.getByTestId('export-toggle')
  await expect(toggle).toBeEnabled()
  await toggle.click()

  const menu = page.getByTestId('export-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveCount(3)

  const box = await menu.boundingBox()
  const toolbar = await page.locator('.toolbar').boundingBox()
  const view = page.viewportSize()
  if (!box || !toolbar) throw new Error('the menu or toolbar has no box')

  expect(box.x + box.width).toBeLessThanOrEqual((view?.width ?? 0) + 0.5)
  expect(box.y + box.height).toBeLessThanOrEqual((view?.height ?? 0) + 0.5)
  // Reaching down over the canvas: a menu that took part in the toolbar's flex
  // row would move the diagram out from under the cursor as it opened.
  expect(box.y + box.height).toBeGreaterThan(toolbar.y + toolbar.height)
  expect(Math.abs((await editor.canvasBox()).y - canvasTopBefore)).toBeLessThan(0.5)

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('the downloaded SVG is a standalone, well-formed file', async ({ page }) => {
  const editor = new Editor(page)
  await buildDiagram(editor)

  const download = await downloadFrom(page, 'export-svg')
  expect(download.suggestedFilename()).toMatch(/\.svg$/)
  const markup = (await downloadBytes(download)).toString('utf8')

  // Standalone, so it opens in an image viewer and not only in a browser.
  expect(markup.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  expect(markup).toContain('<svg xmlns="http://www.w3.org/2000/svg"')

  // Judged by a real XML parser rather than by a regex over the string.
  const parsed = await page.evaluate((source: string) => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return null
    const defined = [...doc.querySelectorAll('marker')].map((node) => node.id)
    const referenced = [...doc.querySelectorAll('[marker-end]')].map((node) =>
      (node.getAttribute('marker-end') ?? '').slice(5, -1),
    )
    return {
      root: doc.documentElement.tagName,
      blocks: doc.querySelectorAll('.block__shape').length,
      lines: doc.querySelectorAll('.connection__line').length,
      styleBlocks: doc.querySelectorAll('style').length,
      markers: defined.length,
      dangling: referenced.filter((id) => !defined.includes(id)),
    }
  }, markup)

  expect(parsed).not.toBeNull()
  expect(parsed?.root).toBe('svg')
  expect(parsed?.blocks).toBe(2)
  expect(parsed?.lines).toBe(1)
  // Its own stylesheet, embedded: a file that depended on the app's CSS would
  // render as black shapes anywhere else.
  expect(parsed?.styleBlocks).toBe(1)
  // An arrowhead pointing at a marker the file does not define is an arrow
  // that renders headless everywhere but in the tab that made it.
  expect(parsed?.markers).toBeGreaterThan(0)
  expect(parsed?.dangling).toEqual([])
})

test('the downloaded SVG carries no editing chrome', async ({ page }) => {
  const editor = new Editor(page)
  await buildDiagram(editor)
  // Select something, so the grid, the selection outline and the fat hit paths
  // are all on screen at the moment of export. An exporter that scraped the
  // live DOM would pick up every one of them.
  await page.keyboard.press('Control+a')

  const markup = (await downloadBytes(await downloadFrom(page, 'export-svg'))).toString(
    'utf8',
  )
  for (const chrome of [
    'canvas__grid',
    'marquee',
    'selection__',
    'block__selection',
    'connection__hit',
    'connection__halo',
    'data-block-id',
    'ports',
  ]) {
    expect(markup).not.toContain(chrome)
  }
})

test('the downloaded PNG is a real drawing, not a correctly sized blank', async ({
  page,
}) => {
  const editor = new Editor(page)
  await buildDiagram(editor)

  const download = await downloadFrom(page, 'export-png-2x')
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  const bytes = await downloadBytes(download)

  expect(bytes.length).toBeGreaterThan(1000)
  // The eight-byte PNG signature, checked rather than inferred from the name.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  // Handed back to the browser to decode, because deciding whether a PNG is
  // blank means looking at its pixels and nothing else will do.
  const raster = await page.evaluate(async (base64: string) => {
    const binary = atob(base64)
    const buffer = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at += 1) buffer[at] = binary.charCodeAt(at)
    const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }))

    const probe = document.createElement('canvas')
    probe.width = bitmap.width
    probe.height = bitmap.height
    const context = probe.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

    const colours = new Set<string>()
    let opaque = 0
    for (let at = 0; at < data.length; at += 4) {
      if ((data[at + 3] ?? 0) > 0) opaque += 1
      // Capped rather than broken out of: the opacity tally has to see every
      // pixel, and an anti-aliased drawing has thousands of shades.
      if (colours.size <= 64) {
        colours.add(`${data[at]},${data[at + 1]},${data[at + 2]}`)
      }
    }

    return {
      width: bitmap.width,
      height: bitmap.height,
      distinctColours: colours.size,
      opaquePixels: opaque,
      totalPixels: data.length / 4,
    }
  }, bytes.toString('base64'))

  if (!raster) throw new Error('the browser could not decode the exported PNG')
  expect(raster.width).toBeGreaterThan(0)
  // Opaque everywhere: a transparent PNG dropped into a light document looks
  // like a blank space with dark text on it.
  expect(raster.opaquePixels).toBe(raster.totalPixels)
  // The check jsdom structurally cannot make.
  expect(raster.distinctColours).toBeGreaterThan(3)
})

test('the 1x and 2x exports differ only in scale', async ({ page }) => {
  const editor = new Editor(page)
  await buildDiagram(editor)

  const measure = async (testId: string) => {
    const bytes = await downloadBytes(await downloadFrom(page, testId))
    // The PNG header puts width and height at bytes 16..24, big-endian.
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }

  const one = await measure('export-png-1x')
  const two = await measure('export-png-2x')
  expect(two.width).toBe(one.width * 2)
  expect(two.height).toBe(one.height * 2)
})

test('the export frames the content, not wherever the camera happened to be', async ({
  page,
}) => {
  const editor = new Editor(page)
  await buildDiagram(editor)
  const framed = (
    await downloadBytes(await downloadFrom(page, 'export-png-1x'))
  ).readUInt32BE(16)

  // Pan a long way off, so nothing is on screen at all.
  await page.keyboard.press('Escape')
  const from = await editor.screen(60, 560)
  await page.keyboard.down('Space')
  await editor.drag(from, { x: from.x - 600, y: from.y - 400 })
  await page.keyboard.up('Space')

  const after = (
    await downloadBytes(await downloadFrom(page, 'export-png-1x'))
  ).readUInt32BE(16)
  // Where the camera was sitting is a property of one person's session — it is
  // not even saved with the document — so two people must get the same file.
  expect(after).toBe(framed)
})
