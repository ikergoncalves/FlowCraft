import { expect, test } from '@playwright/test'
import { Editor, expectClose } from './editor'

/**
 * Styling, the properties panel, and grouping.
 *
 * `getComputedStyle` is the reason this file cannot be a unit test. The
 * Phase 5 bug it exists to prevent was styles written as presentation
 * attributes, which are correct in every assertion that reads the attribute
 * back and wrong in the only one that matters: an attribute sits at the bottom
 * of the SVG cascade and loses to the `.block__shape` class. Nothing but a
 * real renderer resolving a real stylesheet can tell those two apart.
 */

const ORANGE = '#e2683c'
const ORANGE_RGB = 'rgb(226, 104, 60)'

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

test('the panel appears with a selection and goes when it is cleared', async ({
  page,
}) => {
  const editor = new Editor(page)
  await expect(page.getByTestId('properties-panel')).toHaveCount(0)

  const block = await editor.createBlockAt(300, 240)
  const centre = await editor.centerOf(block)
  await page.mouse.click(centre.x, centre.y)

  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('block-properties')).toBeVisible()
  await expect(panel.getByTestId('connection-properties')).toHaveCount(0)
  await expect(panel.getByTestId('swatch')).not.toHaveCount(0)

  await page.keyboard.press('Escape')
  const empty = await editor.screen(60, 560)
  await page.mouse.click(empty.x, empty.y)
  await expect(page.getByTestId('properties-panel')).toHaveCount(0)
})

test('the panel has a real box that leaves the canvas mostly clear', async ({ page }) => {
  // A layout fact, and therefore one only a real renderer can produce.
  const editor = new Editor(page)
  const block = await editor.createBlockAt(300, 240)
  const centre = await editor.centerOf(block)
  await page.mouse.click(centre.x, centre.y)

  const panel = await page.getByTestId('properties-panel').boundingBox()
  const canvas = await editor.canvasBox()
  if (!panel) throw new Error('the panel has no box')

  expect(panel.width).toBeGreaterThan(0)
  expect(panel.height).toBeGreaterThan(0)
  expect(panel.width).toBeLessThan(canvas.width * 0.4)
  const view = page.viewportSize()
  expect(panel.x + panel.width).toBeLessThanOrEqual((view?.width ?? 0) + 0.5)
  expect(panel.y + panel.height).toBeLessThanOrEqual((view?.height ?? 0) + 0.5)
})

test('an unstyled block paints from the stylesheet and sets no inline fill', async ({
  page,
}) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(300, 240)

  const paint = await editor.blockPaint(block.id)
  expect(paint?.hasInlineFill).toBe(false)
  expect(paint?.fill).toBeTruthy()
  expect(paint?.fill).not.toBe('none')
})

test('a swatch really repaints the block, and undo really takes it back', async ({
  page,
}) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(300, 240)
  const centre = await editor.centerOf(block)
  await page.mouse.click(centre.x, centre.y)

  const before = await editor.blockPaint(block.id)
  await editor.clickSwatch(ORANGE)

  const painted = await editor.blockPaint(block.id)
  // The cascade's answer, not the attribute's: this is the assertion that
  // catches a style written where the class beats it.
  expect(painted?.fill).toBe(ORANGE_RGB)
  expect(painted?.hasInlineFill).toBe(true)
  expect((await editor.history()).undo?.label).toBe('Undo: Set fill')

  await page.keyboard.press('Control+z')
  const reverted = await editor.blockPaint(block.id)
  expect(reverted?.hasInlineFill).toBe(false)
  expect(reverted?.fill).toBe(before?.fill)
})

test('a selection whose blocks disagree reports a mixed value', async ({ page }) => {
  const editor = new Editor(page)
  const one = await editor.createBlockAt(220, 200)
  await editor.createBlockAt(560, 200)

  const centre = await editor.centerOf(one)
  await page.mouse.click(centre.x, centre.y)
  await editor.clickSwatch(ORANGE)
  await expect(page.getByTestId('mixed-indicator')).toHaveCount(0)

  await page.keyboard.press('Control+a')
  await expect(page.getByTestId('mixed-indicator')).not.toHaveCount(0)
})

test('arrow markers are derived per colour, not per arrow', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(220, 200)
  const target = await editor.createBlockAt(620, 200)
  await editor.connect(source.id, target.id)

  // An unstyled diagram needs exactly one marker: the default.
  await expect(page.getByTestId('arrow-marker')).toHaveCount(1)

  const hit = await page.getByTestId('connection-hit').first().boundingBox()
  if (!hit) throw new Error('the arrow has no hit area')
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2)
  await expect(page.getByTestId('connection-properties')).toBeVisible()

  await page.getByLabel(`Line: ${ORANGE}`).click()

  const painted = await page.evaluate(() => {
    const line = document.querySelector('.connection__line')
    const markers = [...document.querySelectorAll('[data-testid="arrow-marker"]')]
    return {
      stroke: line ? getComputedStyle(line).stroke : null,
      markerEnd: line?.getAttribute('marker-end') ?? null,
      count: markers.length,
      fills: markers.map((node) => {
        const path = node.querySelector('path')
        return path ? getComputedStyle(path).fill : null
      }),
    }
  })

  expect(painted.stroke).toBe(ORANGE_RGB)
  expect(painted.markerEnd).toBe('url(#flowcraft-arrow-e2683c)')
  // Default plus one derived marker — not one per connection, which is the
  // whole reason markers are keyed on colour.
  expect(painted.count).toBe(2)
  expect(painted.fills).toContain(ORANGE_RGB)

  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('arrow-marker')).toHaveCount(1)
})

test('grouping replaces the multi-selection box with a group outline', async ({
  page,
}) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(200, 200)
  const second = await editor.createBlockAt(200, 420)

  await editor.clickBlock(first.id)
  await editor.clickBlock(second.id, { shift: true })
  await expect(page.getByTestId('selection-bounds')).toHaveCount(1)
  await page.keyboard.press('Control+g')

  await expect(page.getByTestId('group-bounds')).toHaveCount(1)
  await expect(page.getByTestId('selection-bounds')).toHaveCount(0)
  expect((await editor.history()).undo?.label).toBe('Undo: Group 2 blocks')

  const stroke = await page
    .getByTestId('group-bounds')
    .evaluate((node) => getComputedStyle(node).stroke)
  expect(stroke).not.toBe('none')
})

test('clicking one member selects the whole group', async ({ page }) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(200, 200)
  const second = await editor.createBlockAt(200, 420)
  const outsider = await editor.createBlockAt(700, 200)

  await editor.groupBlocks(first.id, second.id)

  await editor.clickBlock(outsider.id)
  await expect(page.getByTestId('block-selection')).toHaveCount(1)

  await editor.clickBlock(first.id)
  await expect(page.getByTestId('block-selection')).toHaveCount(2)
  await expect(page.getByTestId('group-bounds')).toHaveCount(1)
})

test('a group moves as one and leaves everything else alone', async ({ page }) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(200, 200)
  const second = await editor.createBlockAt(200, 420)
  const outsider = await editor.createBlockAt(700, 200)

  await editor.groupBlocks(first.id, second.id)

  const grab = await editor.centerOf(first)
  await editor.drag(grab, { x: grab.x + 130, y: grab.y + 70 })

  expectClose((await editor.blockById(first.id)).x, first.x + 130)
  expectClose((await editor.blockById(second.id)).x, second.x + 130)
  expectClose((await editor.blockById(second.id)).y, second.y + 70)
  expectClose((await editor.blockById(outsider.id)).x, outsider.x)
})

test('double-click steps into a group, and Ctrl+Shift+G dissolves it', async ({
  page,
}) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(200, 200)
  const second = await editor.createBlockAt(200, 420)

  await editor.groupBlocks(first.id, second.id)

  const firstCentre = await editor.centerOf(await editor.blockById(first.id))
  await page.mouse.dblclick(firstCentre.x, firstCentre.y)
  await expect(page.getByTestId('block-selection')).toHaveCount(1)
  await expect(page.getByTestId('group-bounds')).toHaveCount(0)

  // Still inside: clicking the member you just singled out keeps it singled
  // out, or dragging what you had just isolated would re-widen to the group
  // under your hand.
  await editor.clickBlock(first.id)
  await expect(page.getByTestId('block-selection')).toHaveCount(1)

  // Leaving and coming back is what steps out again.
  const empty = await editor.screen(900, 560)
  await page.mouse.click(empty.x, empty.y)
  await editor.clickBlock(first.id)
  await expect(page.getByTestId('group-bounds')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+g')
  await expect(page.getByTestId('group-bounds')).toHaveCount(0)
  await expect(page.getByTestId('selection-bounds')).toHaveCount(1)
  expect(await editor.blocks()).toHaveLength(2)
})

test('deleting a group takes every member, and undo brings the group back', async ({
  page,
}) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(200, 200)
  const second = await editor.createBlockAt(200, 420)
  await editor.createBlockAt(700, 200)

  await editor.groupBlocks(first.id, second.id)

  await editor.clickBlock(first.id)
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await editor.blocks()).length).toBe(1)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await editor.blocks()).length).toBe(3)
  // The membership has to come back too, not just the blocks.
  await expect(page.getByTestId('group-bounds')).toHaveCount(1)
})
