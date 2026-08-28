import { expect, test } from '@playwright/test'
import { Editor, expectClose } from './editor'

/**
 * Pointer gestures in a renderer that has layout, hit testing and pointer
 * capture — the three things jsdom does not implement, and therefore the three
 * things a gesture regression only shows up in.
 *
 * The drag-tracking assertions are exact to a hundredth of a world unit. That
 * is the whole point of them: the bug that made this suite necessary was a
 * dragged block trailing the cursor by exactly the 3px tap threshold, which
 * every approximate assertion in the repository was happy to accept.
 */

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

test('a dragged block tracks the cursor exactly, not three pixels behind it', async ({
  page,
}) => {
  const editor = new Editor(page)
  const created = await editor.createBlockAt(300, 240)
  const start = await editor.centerOf(created)
  const travel = { x: 187, y: 123 }

  await editor.drag(start, { x: start.x + travel.x, y: start.y + travel.y })

  const moved = await editor.blockById(created.id)
  // @use-gesture's `movement` latches the tap threshold and would leave both
  // of these exactly 3 short, forever.
  expectClose(moved.x, created.x + travel.x)
  expectClose(moved.y, created.y + travel.y)
})

test('a drag stays exact however many moves it is made of', async ({ page }) => {
  // A gesture that accumulated per-frame deltas would drift with the step
  // count; one that works from a snapshot cannot.
  const editor = new Editor(page)
  const created = await editor.createBlockAt(300, 240)
  const start = await editor.centerOf(created)

  await editor.drag(start, { x: start.x + 200, y: start.y }, { steps: 60 })

  expectClose((await editor.blockById(created.id)).x, created.x + 200)
})

test('Escape mid-drag rewinds the block and records no history', async ({ page }) => {
  const editor = new Editor(page)
  const created = await editor.createBlockAt(340, 260)
  const from = await editor.centerOf(created)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 90, from.y + 40, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()

  expectClose((await editor.blockById(created.id)).x, created.x)
  const history = await editor.history()
  expect(history.undo?.label).not.toBe('Undo: Move block')
})

test('a marquee over empty canvas selects the blocks it crosses', async ({ page }) => {
  const editor = new Editor(page)
  const left = await editor.createBlockAt(240, 220)
  const right = await editor.createBlockAt(560, 220)
  const away = await editor.createBlockAt(900, 700)

  const from = await editor.screen(120, 120)
  const to = await editor.screen(720, 330)
  await editor.drag(from, to, { steps: 16 })

  await expect(page.getByTestId('block-selection')).toHaveCount(2)
  const selected = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="block-selection"]')].map((node) =>
      node.parentElement?.getAttribute('data-block-id'),
    ),
  )
  expect(selected).toContain(left.id)
  expect(selected).toContain(right.id)
  expect(selected).not.toContain(away.id)
})

test('hovering a block reveals its ports, and moving away takes them back', async ({
  page,
}) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(400, 300)
  const centre = await editor.centerOf(block)

  await page.mouse.move(centre.x, centre.y)
  await expect(page.locator(`[data-port-block="${block.id}"]`)).toHaveCount(4)

  const corner = await editor.screen(20, 620)
  await page.mouse.move(corner.x, corner.y)
  await expect(page.locator(`[data-port-block="${block.id}"]`)).toHaveCount(0)
})

test('a resize handle moves one edge and holds the opposite one still', async ({
  page,
}) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(400, 300)
  const centre = await editor.centerOf(block)
  await page.mouse.click(centre.x, centre.y)

  const handle = page.locator('[data-resize-handle="e"]')
  await expect(handle).toBeAttached()
  const box = await handle.boundingBox()
  if (!box) throw new Error('the east handle has no box')

  await editor.drag(
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2 + 60, y: box.y + box.height / 2 },
  )

  const resized = await editor.blockById(block.id)
  expectClose(resized.width, block.width + 60)
  expectClose(resized.x, block.x)
  expectClose(resized.height, block.height)
})

test('the space key turns a drag into a pan without moving the block', async ({
  page,
}) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(400, 300)
  const centre = await editor.centerOf(block)

  await page.keyboard.down('Space')
  await editor.drag(centre, { x: centre.x - 120, y: centre.y - 80 })
  await page.keyboard.up('Space')

  // The block did not move in *world* space; the camera did, so it is drawn
  // somewhere else on screen.
  const after = await editor.blockById(block.id)
  expectClose(after.x, block.x)
  expectClose(after.y, block.y)
  const viewBox = await editor.canvas().getAttribute('viewBox')
  expect(viewBox?.startsWith('0 0')).toBe(false)
})

test('zooming with the wheel and returning lands back where it started', async ({
  page,
}) => {
  const editor = new Editor(page)
  await editor.createBlockAt(400, 300)
  const before = await editor.canvas().getAttribute('viewBox')

  const at = await editor.screen(400, 300)
  await page.mouse.move(at.x, at.y)
  await page.mouse.wheel(0, -240)
  await expect(editor.canvas()).not.toHaveAttribute('viewBox', before ?? '')
  await page.mouse.wheel(0, 240)

  // Exponential steps, so in and out by the same delta is the identity.
  const after = await editor.canvas().getAttribute('viewBox')
  const parse = (value: string | null) => {
    const [x = 0, y = 0, width = 0] = (value ?? '').split(' ').map(Number)
    return { x, y, width }
  }
  const was = parse(before)
  const is = parse(after)
  expectClose(is.x, was.x, 0.5)
  expectClose(is.y, was.y, 0.5)
  expectClose(is.width, was.width, 0.5)
})

test('holding Alt inverts snapping for the duration of the gesture', async ({ page }) => {
  const editor = new Editor(page)
  // Snapping was turned off in beforeEach, so Alt turns it back on.
  const block = await editor.createBlockAt(400, 300)
  const centre = await editor.centerOf(block)

  await page.keyboard.down('Alt')
  await editor.drag(centre, { x: centre.x + 37, y: centre.y + 23 })
  await page.keyboard.up('Alt')

  const moved = await editor.blockById(block.id)
  expect(moved.x % 20).toBe(0)
  expect(moved.y % 20).toBe(0)
})
