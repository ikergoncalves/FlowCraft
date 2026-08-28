import { expect, test, type Page } from '@playwright/test'
import { downloadBytes, downloadFrom, Editor } from './editor'

/**
 * Viewport culling, in a real browser, on a diagram far larger than anyone
 * would draw by hand.
 *
 * This is the one place in the suite that goes through the debug bridge rather
 * than clicking, and the reason is arithmetic: 800 blocks at one click each is
 * a five-minute test. Everything *asserted* is still read out of the page the
 * way a user would experience it — what is on screen, what the export
 * contains, what survives a reload.
 *
 * The failure this guards against does not look like a crash. It looks like
 * someone opening their diagram, seeing part of it, saving, and losing the
 * rest. So every check here asks a different consumer whether the document is
 * still whole.
 */

const BLOCKS = 800
const CONNECTIONS = 1200

/** The generator's own id scheme, mirrored from `src/dev/bigDiagram.ts`. */
const blockId = (index: number) => `perf-b-${String(index).padStart(5, '0')}`

async function seed(page: Page) {
  return page.evaluate(
    ([blocks, connections]) =>
      window.__flowcraft.seed({ blocks: blocks ?? 0, connections: connections ?? 0 }),
    [BLOCKS, CONNECTIONS],
  )
}

const counts = (page: Page) =>
  page.evaluate(() => ({
    document: window.__flowcraft.count(),
    rendered: window.__flowcraft.rendered(),
  }))

test.beforeEach(async ({ page }) => {
  await Editor.open(page)
})

test('a large diagram renders only a small part of itself', async ({ page }) => {
  const seeded = await seed(page)
  expect(seeded.blocks).toBe(BLOCKS)

  const { document, rendered } = await counts(page)
  expect(document.blocks).toBe(BLOCKS)
  expect(document.connections).toBe(CONNECTIONS)
  // A 1280x900 window at zoom 1 can show about thirty blocks. Anything close
  // to the full count means the culling has stopped working.
  expect(rendered.blocks).toBeGreaterThan(0)
  expect(rendered.blocks).toBeLessThan(BLOCKS / 4)
  expect(rendered.connections).toBeLessThan(CONNECTIONS / 4)
})

test('what is on screen is on screen — nothing visible is culled', async ({ page }) => {
  await seed(page)

  const missing = await page.evaluate(() => {
    const canvas = document
      .querySelector('[data-testid="canvas"]')
      ?.getBoundingClientRect()
    if (!canvas) return ['no canvas']
    // Every block the document holds, projected to screen coordinates at the
    // current viewBox, and checked against what is actually in the DOM.
    const drawn = new Set(
      [...document.querySelectorAll('[data-block-id]')].map((node) =>
        node.getAttribute('data-block-id'),
      ),
    )
    const gaps: string[] = []
    const grid = 260
    const rows = 140
    const columns = Math.ceil(Math.sqrt(800))
    for (let index = 0; index < 800; index += 1) {
      const x = (index % columns) * grid
      const y = Math.floor(index / columns) * rows
      const onScreen = x < canvas.width && y < canvas.height
      const id = `perf-b-${String(index).padStart(5, '0')}`
      if (onScreen && !drawn.has(id)) gaps.push(id)
    }
    return gaps
  })

  expect(missing).toEqual([])
})

test('panning brings the far side of the diagram into view', async ({ page }) => {
  await seed(page)
  const far = blockId(BLOCKS - 1)
  await expect(page.locator(`[data-block-id="${far}"]`)).toHaveCount(0)

  await page.evaluate((id: string) => {
    // Park the camera on the last block, which is at the bottom-right corner
    // of the grid and has never been rendered.
    const columns = Math.ceil(Math.sqrt(800))
    const index = Number(id.slice(-5))
    window.__flowcraft.setViewport({
      x: (index % columns) * 260 - 200,
      y: Math.floor(index / columns) * 140 - 200,
      zoom: 1,
    })
  }, far)

  await expect(page.locator(`[data-block-id="${far}"]`)).toHaveCount(1)

  // And it goes away again when the camera leaves, or this is not culling.
  await page.evaluate(() => {
    window.__flowcraft.setViewport({ x: 0, y: 0, zoom: 1 })
  })
  await expect(page.locator(`[data-block-id="${far}"]`)).toHaveCount(0)
})

test('zooming out far enough renders the whole diagram', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => {
    window.__flowcraft.setViewport({ x: 0, y: 0, zoom: 0.1 })
  })
  await expect.poll(async () => (await counts(page)).rendered.blocks).toBe(BLOCKS)
})

test('the export contains every block, culled or not', async ({ page }) => {
  await seed(page)
  const { rendered } = await counts(page)
  expect(rendered.blocks).toBeLessThan(BLOCKS)

  const markup = (await downloadBytes(await downloadFrom(page, 'export-svg'))).toString(
    'utf8',
  )

  // The export is built from the document, never scraped from the live SVG.
  // If it were scraped, this would be the sixty-odd blocks that happened to be
  // on screen — which is the exact shape of "my diagram came out empty".
  expect(markup.match(/class="block__shape"/g)).toHaveLength(BLOCKS)
  expect(markup.match(/class="connection__line"/g)).toHaveLength(CONNECTIONS)
})

test('every block survives a reload, culled or not', async ({ page }) => {
  await seed(page)

  await expect
    .poll(
      async () => {
        const stored = await new Editor(page).stored()
        const document = stored.document as { blocks?: object } | null
        return Object.keys(document?.blocks ?? {}).length
      },
      { timeout: 10_000 },
    )
    .toBe(BLOCKS)

  await page.reload()
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'loading',
  )
  const after = await counts(page)
  expect(after.document.blocks).toBe(BLOCKS)
  expect(after.document.connections).toBe(CONNECTIONS)
  expect(after.rendered.blocks).toBeLessThan(BLOCKS)
})

test('Select All reaches every block, culled or not', async ({ page }) => {
  await seed(page)
  await page.keyboard.press('Control+a')

  // The selection is not culled, so selecting everything renders everything —
  // which is itself the guarantee that a dragged block never vanishes.
  await expect.poll(async () => (await counts(page)).rendered.blocks).toBe(BLOCKS)
})

test('the selection is never culled, wherever the camera goes', async ({ page }) => {
  // The rule that stops a block vanishing from under the cursor mid-drag, and
  // the reason a nudged selection keeps its outline. Driven by moving the
  // camera rather than the block, because a pointer cannot travel further than
  // the window and a block has to end up genuinely far away for this to mean
  // anything.
  const editor = new Editor(page)
  await seed(page)

  const held = blockId(0)
  const neighbour = blockId(1)
  await editor.clickBlock(held)
  await expect(page.locator(`[data-block-id="${neighbour}"]`)).toHaveCount(1)

  await page.evaluate(() => {
    window.__flowcraft.setViewport({ x: 40_000, y: 40_000, zoom: 1 })
  })

  // Its unselected neighbour is gone; the selected one is not.
  await expect(page.locator(`[data-block-id="${neighbour}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-block-id="${held}"]`)).toHaveCount(1)
  await expect(page.getByTestId('block-selection')).toHaveCount(1)
})

test('a block stays drawn while it is dragged to the far edge', async ({ page }) => {
  const editor = new Editor(page)
  await editor.disableSnap()
  await seed(page)

  const first = await editor.blockById(blockId(0))
  const centre = await editor.centerOf(first)
  const canvas = await editor.canvasBox()

  await editor.drag(
    centre,
    { x: canvas.x + canvas.width - 4, y: centre.y },
    { steps: 24 },
  )

  await expect(page.locator(`[data-block-id="${blockId(0)}"]`)).toHaveCount(1)
})
