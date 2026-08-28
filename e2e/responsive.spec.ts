import { expect, test } from '@playwright/test'
import { Editor } from './editor'

/**
 * The narrow breakpoint.
 *
 * `@media (width <= 560px)` was written in Phase 5 and went unchecked for a
 * whole phase: the CDP harness ran at 1280x900, where the rule does not apply,
 * and jsdom evaluates no media queries at all. Everything asserted here is a
 * layout fact, so a real renderer at a real size is the only place any of it
 * can be established.
 */

test.describe('at 400x800', () => {
  test.use({ viewport: { width: 400, height: 800 } })

  test('the properties panel becomes a bottom strip that clears the canvas', async ({
    page,
  }) => {
    const editor = await Editor.open(page)
    // Both in the upper half: creating the first one selects it, which brings
    // the bottom strip up, and a click aimed at the lower half would land on
    // the panel rather than on the canvas.
    await editor.createBlockAt(120, 120)
    await editor.createBlockAt(120, 260)
    await page.keyboard.press('Control+a')

    const panel = await page.getByTestId('properties-panel').boundingBox()
    const canvas = await editor.canvasBox()
    if (!panel) throw new Error('no panel at 400px')

    expect(panel.x + panel.width).toBeLessThanOrEqual(400.5)
    expect(panel.y + panel.height).toBeLessThanOrEqual(800.5)
    // A strip across the bottom rather than a column down the side.
    expect(panel.width).toBeGreaterThan(canvas.width * 0.8)
    expect(panel.y).toBeGreaterThan(canvas.y + canvas.height / 2)
    expect(panel.height).toBeLessThan(canvas.height * 0.5)
  })

  test('nothing overflows the page sideways', async ({ page }) => {
    const editor = await Editor.open(page)
    await editor.createBlockAt(120, 220)
    await page.keyboard.press('Control+a')

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflows).toBe(false)
  })

  test('the zoom indicator is not buried under the panel', async ({ page }) => {
    const editor = await Editor.open(page)
    await editor.createBlockAt(120, 220)
    await page.keyboard.press('Control+a')

    const clear = await page.evaluate(() => {
      const zoom = document.querySelector('.zoom-indicator')?.getBoundingClientRect()
      const panel = document
        .querySelector('[data-testid="properties-panel"]')
        ?.getBoundingClientRect()
      if (!zoom || !panel) return false
      return zoom.bottom <= panel.top || zoom.top >= panel.bottom
    })
    expect(clear).toBe(true)
  })

  test('every toolbar button is still reachable', async ({ page }) => {
    await Editor.open(page)
    const clipped = await page.evaluate(() => {
      const bar = document.querySelector('.toolbar')?.getBoundingClientRect()
      if (!bar) return true
      return [...document.querySelectorAll('.toolbar button')].some((node) => {
        const box = node.getBoundingClientRect()
        return box.width === 0 || box.left < bar.left - 0.5 || box.right > bar.right + 0.5
      })
    })
    expect(clipped).toBe(false)
  })
})

test.describe('back at a desktop size', () => {
  test('the panel returns to a side column', async ({ page }) => {
    const editor = await Editor.open(page)
    await editor.createBlockAt(300, 240)
    await page.keyboard.press('Control+a')

    const panel = await page.getByTestId('properties-panel').boundingBox()
    const canvas = await editor.canvasBox()
    if (!panel) throw new Error('no panel at 1280px')
    expect(panel.width).toBeLessThan(canvas.width * 0.4)
  })
})
