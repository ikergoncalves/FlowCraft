import { expect, test } from '@playwright/test'
import { Editor, expectClose } from './editor'

/**
 * Wiring blocks together, and the property that makes it work: a connection
 * stores ids and nothing else, so its route is a function of where its blocks
 * are right now.
 *
 * The re-routing assertions below are the ones worth having. An arrow that
 * happened to be drawn correctly once could be storing coordinates; an arrow
 * that redraws itself when its block moves, with no synchronising code, cannot.
 */

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

test('dragging from a port onto another block draws an arrow', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(260, 240)
  const target = await editor.createBlockAt(660, 240)

  expect(await editor.connectionIds()).toHaveLength(0)
  await editor.connect(source.id, target.id)
  expect(await editor.connectionIds()).toHaveLength(1)
})

test('an arrow re-routes itself when its block moves', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(260, 240)
  const target = await editor.createBlockAt(660, 240)
  await editor.connect(source.id, target.id)

  const line = page.getByTestId('connection-line').first()
  const before = await line.getAttribute('d')

  const centre = await editor.centerOf(await editor.blockById(target.id))
  await editor.drag(centre, { x: centre.x, y: centre.y + 260 })

  // Nothing subscribed, nothing invalidated a cache: the path is recomputed
  // from the two live rects on every render.
  expect(await line.getAttribute('d')).not.toBe(before)
})

test('the pinned end stays put while the free end re-routes', async ({ page }) => {
  // Drawing from the east port *pins* the source side; the target end was
  // dropped on the block body, so it stays free. Moving the target to the far
  // side of the source therefore has to do two different things at once, and
  // that split is the whole point of `resolveAnchors`.
  const editor = new Editor(page)
  const source = await editor.createBlockAt(500, 240)
  const target = await editor.createBlockAt(880, 240)
  await editor.connect(source.id, target.id)

  /**
   * The first and last points of the drawn path.
   *
   * Read by pulling the numbers out of the `d` string rather than by matching
   * its command letters: a route with rounded corners is a mix of `L` and `A`,
   * and both of those end with the coordinate pair we want.
   */
  const ends = async () => {
    const d = (await page.getByTestId('connection-line').first().getAttribute('d')) ?? ''
    const numbers = d
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => !Number.isNaN(value))
    return {
      from: { x: numbers[0] ?? NaN, y: numbers[1] ?? NaN },
      to: {
        x: numbers[numbers.length - 2] ?? NaN,
        y: numbers[numbers.length - 1] ?? NaN,
      },
    }
  }

  const sourceBlock = await editor.blockById(source.id)
  const before = await ends()
  expectClose(before.from.x, sourceBlock.x + sourceBlock.width, 1)

  const centre = await editor.centerOf(await editor.blockById(target.id))
  await editor.drag(centre, { x: centre.x - 720, y: centre.y })

  const after = await ends()
  const movedTarget = await editor.blockById(target.id)
  // Pinned: still leaving the source's east edge, even though the target is
  // now to the west.
  expectClose(after.from.x, sourceBlock.x + sourceBlock.width, 1)
  // Free: now arriving at the target's east edge rather than its west.
  expectClose(after.to.x, movedTarget.x + movedTarget.width, 1)
})

test('a block cannot be wired to itself', async ({ page }) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(400, 300)

  const port = await editor.portOf(block.id, 'e')
  const centre = await editor.centerOf(block)
  await editor.drag(port, centre, { steps: 12 })

  expect(await editor.connectionIds()).toHaveLength(0)
})

test('the same link cannot be drawn twice', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(260, 240)
  const target = await editor.createBlockAt(660, 240)

  await editor.connect(source.id, target.id)
  await editor.connect(source.id, target.id)
  expect(await editor.connectionIds()).toHaveLength(1)
})

test('a ghost line follows the pointer before the arrow lands', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(260, 240)
  const target = await editor.createBlockAt(660, 240)

  const port = await editor.portOf(source.id, 'e')
  const to = await editor.centerOf(await editor.blockById(target.id))

  await page.mouse.move(port.x, port.y)
  await page.mouse.down()
  await page.mouse.move(port.x + 120, port.y + 20, { steps: 8 })
  await expect(page.getByTestId('connection-ghost')).toBeAttached()

  // And the block it would land on is highlighted.
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect(page.getByTestId('connect-target')).toHaveAttribute(
    'data-connect-target-id',
    target.id,
  )

  await page.mouse.up()
  await expect(page.getByTestId('connection-ghost')).toHaveCount(0)
  expect(await editor.connectionIds()).toHaveLength(1)
})

test('clicking an arrow selects it, and Delete removes only the arrow', async ({
  page,
}) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(260, 240)
  const target = await editor.createBlockAt(660, 240)
  await editor.connect(source.id, target.id)

  const hit = page.getByTestId('connection-hit').first()
  const box = await hit.boundingBox()
  if (!box) throw new Error('the arrow has no hit area')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('connection-halo')).toHaveCount(1)

  await page.keyboard.press('Delete')
  expect(await editor.connectionIds()).toHaveLength(0)
  // Deleting an arrow is not deleting the blocks it joined.
  expect(await editor.blocks()).toHaveLength(2)
})
