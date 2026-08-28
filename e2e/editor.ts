import { expect, type Download, type Locator, type Page } from '@playwright/test'

/**
 * The vocabulary the specs are written in.
 *
 * These are the readers and gestures that the CDP harness of Phases 3–6 grew
 * one at a time, moved behind names. The rule they were all written under
 * carries over unchanged: **drive the editor the way a user does, and read
 * what the browser actually produced.** Nothing here reaches into the store to
 * set up a scenario — a test that seeds its state through a back door stops
 * being able to fail for the reasons users hit.
 *
 * Coordinates are the other inheritance. `screen()` converts world units to
 * client pixels through the canvas's real box, so an assertion can say "the
 * block should be exactly 187 units to the right" and mean it. Approximate
 * assertions are what let the Phase 3 cursor-lag bug live for a whole phase.
 */

export interface RenderedBlock {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: string
}

export class Editor {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  /**
   * Opens the editor and waits until it is ready to be driven.
   *
   * Waiting on the canvas alone is not enough: the restore from IndexedDB is
   * asynchronous, so a spec that started clicking immediately could have its
   * first block wiped by a restore landing a moment later.
   */
  static async open(page: Page): Promise<Editor> {
    const editor = new Editor(page)
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
      'data-status',
      'loading',
    )
    return editor
  }

  /**
   * Turns snapping off.
   *
   * Almost every spec wants this: with the grid on, every expected coordinate
   * would be rounded onto it, and the assertions would stop measuring pointer
   * tracking at all.
   */
  async disableSnap() {
    await this.page.keyboard.press('g')
    await expect(this.page.locator('[title^="Snap to grid"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }

  canvas(): Locator {
    return this.page.getByTestId('canvas')
  }

  /** The canvas's box in client pixels. */
  async canvasBox() {
    const box = await this.canvas().boundingBox()
    if (!box) throw new Error('the canvas has no box')
    return box
  }

  /** World units -> client pixels, at the default viewport. */
  async screen(x: number, y: number) {
    const box = await this.canvasBox()
    return { x: box.x + x, y: box.y + y }
  }

  async centerOf(block: RenderedBlock) {
    return this.screen(block.x + block.width / 2, block.y + block.height / 2)
  }

  /** Every block currently in the DOM, in world units, read out of the SVG. */
  blocks(): Promise<RenderedBlock[]> {
    return this.page.evaluate(() =>
      [...document.querySelectorAll('[data-block-id]')].map((node) => {
        const shape = node.querySelector('rect')
        const text = node.querySelector('text')
        return {
          id: node.getAttribute('data-block-id') ?? '',
          x: Number(shape?.getAttribute('x')),
          y: Number(shape?.getAttribute('y')),
          width: Number(shape?.getAttribute('width')),
          height: Number(shape?.getAttribute('height')),
          text: text?.textContent ?? '',
        }
      }),
    )
  }

  async blockById(id: string): Promise<RenderedBlock> {
    const found = (await this.blocks()).find((block) => block.id === id)
    if (!found) throw new Error(`no block ${id} is rendered`)
    return found
  }

  connectionIds(): Promise<string[]> {
    return this.page.evaluate(() =>
      [...document.querySelectorAll('[data-connection-id]')].map(
        (node) => node.getAttribute('data-connection-id') ?? '',
      ),
    )
  }

  /** The undo and redo buttons' state, which is how history is observed. */
  history(): Promise<{
    undo: { disabled: boolean; label: string } | null
    redo: { disabled: boolean; label: string } | null
  }> {
    return this.page.evaluate(() => {
      const read = (id: string) => {
        const node = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
        return node
          ? { disabled: node.disabled, label: node.getAttribute('aria-label') ?? '' }
          : null
      }
      return { undo: read('undo'), redo: read('redo') }
    })
  }

  /** Picks the rectangle tool and clicks, which is how a block is made. */
  async createBlockAt(worldX: number, worldY: number): Promise<RenderedBlock> {
    const before = new Set((await this.blocks()).map((block) => block.id))
    await this.page.keyboard.press('r')
    const at = await this.screen(worldX, worldY)
    await this.page.mouse.click(at.x, at.y)
    await expect.poll(async () => (await this.blocks()).length).toBe(before.size + 1)
    const created = (await this.blocks()).find((block) => !before.has(block.id))
    if (!created) throw new Error('the click created no block')
    return created
  }

  /**
   * A press-move-release drag, moved in steps.
   *
   * The step count is load-bearing, not decoration. A gesture that integrates
   * per-frame deltas instead of working from a snapshot drifts with the number
   * of moves, so a single-jump drag would hide exactly the bug this suite
   * exists to catch.
   */
  async drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    { steps = 12 }: { steps?: number } = {},
  ) {
    await this.page.mouse.move(from.x, from.y)
    await this.page.mouse.down()
    await this.page.mouse.move(to.x, to.y, { steps })
    await this.page.mouse.up()
  }

  /** Hovers a block and reads the world position of one of its ports. */
  async portOf(blockId: string, side: 'n' | 'e' | 's' | 'w') {
    const block = await this.blockById(blockId)
    const centre = await this.centerOf(block)
    await this.page.mouse.move(centre.x, centre.y)
    // `.port__dot` rather than `circle`: each port draws two, an invisible
    // fat hit area and the visible dot, and they share a centre.
    const port = this.page.locator(
      `[data-port-side="${side}"][data-port-block="${blockId}"] .port__dot`,
    )
    await expect(port).toBeAttached()
    const world = await port.evaluate((node) => ({
      x: Number(node.getAttribute('cx')),
      y: Number(node.getAttribute('cy')),
    }))
    return this.screen(world.x, world.y)
  }

  /**
   * Clicks a point, optionally with Shift held.
   *
   * `page.mouse.click` takes no modifiers — only `locator.click` does — and a
   * modifier passed to it is silently ignored, which turns "shift-click to add
   * to the selection" into a plain click that replaces it. Holding the key
   * around the click is the only way to say it through the raw mouse.
   */
  async clickAt(point: { x: number; y: number }, { shift = false } = {}) {
    if (shift) await this.page.keyboard.down('Shift')
    await this.page.mouse.click(point.x, point.y)
    if (shift) await this.page.keyboard.up('Shift')
  }

  /** Clicks a block by its id, wherever it currently is. */
  async clickBlock(id: string, options?: { shift?: boolean }) {
    await this.clickAt(await this.centerOf(await this.blockById(id)), options)
  }

  /** Selects two blocks and groups them, which is a four-step ceremony. */
  async groupBlocks(firstId: string, secondId: string) {
    await this.clickBlock(firstId)
    await this.clickBlock(secondId, { shift: true })
    await this.page.keyboard.press('Control+g')
    await expect(this.page.getByTestId('group-bounds')).toHaveCount(1)
  }

  /** Wires one block to another by dragging from a port onto the target. */
  async connect(sourceId: string, targetId: string) {
    const from = await this.portOf(sourceId, 'e')
    const target = await this.blockById(targetId)
    await this.drag(from, await this.centerOf(target), { steps: 16 })
  }

  /** Empties the canvas through the UI, so a spec can start from a known state. */
  async clearCanvas() {
    await this.page.keyboard.press('Control+a')
    await this.page.keyboard.press('Delete')
    await expect.poll(async () => (await this.blocks()).length).toBe(0)
  }

  /** Clicks a palette swatch by the colour it applies. */
  async clickSwatch(colour: string) {
    await this.page.locator(`[data-swatch="${colour}"]`).first().click()
  }

  /** The computed paint of a block's shape — the cascade's actual answer. */
  blockPaint(id: string) {
    return this.page.evaluate((blockId) => {
      const shape = document.querySelector(`[data-block-id="${blockId}"] .block__shape`)
      if (!shape) return null
      const style = getComputedStyle(shape)
      return {
        fill: style.fill,
        stroke: style.stroke,
        hasInlineFill: (shape as SVGElement).style.fill !== '',
      }
    }, id)
  }

  /** Whatever is currently in IndexedDB under the app's own keys. */
  stored(): Promise<{
    document: Record<string, unknown> | null
    preferences: Record<string, unknown> | null
  }> {
    return this.page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('flowcraft', 1)
          open.onerror = () => {
            resolve({ document: null, preferences: null })
          }
          open.onsuccess = () => {
            const tx = open.result.transaction('state', 'readonly')
            const store = tx.objectStore('state')
            const doc = store.get('document')
            const prefs = store.get('preferences')
            tx.oncomplete = () => {
              open.result.close()
              resolve({
                document: (doc.result as Record<string, unknown>) ?? null,
                preferences: (prefs.result as Record<string, unknown>) ?? null,
              })
            }
          }
        }),
    )
  }
}

/** Exactly, to within floating-point noise — never "about". */
export function expectClose(actual: number, expected: number, tolerance = 0.01) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

/**
 * The bytes of a download.
 *
 * Playwright's read stream is untyped, so the chunk is narrowed here once
 * rather than cast at each of the four call sites.
 */
export async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Opens the export menu and returns the file the given item downloads. */
export async function downloadFrom(page: Page, itemTestId: string): Promise<Download> {
  await page.getByTestId('export-toggle').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(itemTestId).click(),
  ])
  return download
}
