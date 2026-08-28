import { expect, test } from '@playwright/test'
import { Editor, expectClose } from './editor'

/**
 * Undo, redo, and what the toolbar says about them.
 *
 * The labels are assertions about the history's *shape*, not about wording:
 * "Undo: Move block" after a drag proves the whole gesture became one entry,
 * and five arrow presses collapsing into one entry proves the merge policy is
 * running. Both are invisible to a test that only checks coordinates.
 */

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

test('undo and redo start disabled and unlabelled', async ({ page }) => {
  const { undo, redo } = await new Editor(page).history()
  expect(undo?.disabled).toBe(true)
  expect(redo?.disabled).toBe(true)
  expect(undo?.label).toBe('Undo')
})

test('creating a block is one labelled entry', async ({ page }) => {
  const editor = new Editor(page)
  await editor.createBlockAt(300, 240)

  const { undo } = await editor.history()
  expect(undo?.disabled).toBe(false)
  expect(undo?.label).toBe('Undo: Add block')
})

test('a whole drag is one entry, and both shortcuts redo it', async ({ page }) => {
  const editor = new Editor(page)
  const created = await editor.createBlockAt(300, 240)
  const start = await editor.centerOf(created)
  await editor.drag(start, { x: start.x + 187, y: start.y + 123 })

  const moved = await editor.blockById(created.id)
  expect((await editor.history()).undo?.label).toBe('Undo: Move block')

  await page.keyboard.press('Control+z')
  const undone = await editor.blockById(created.id)
  expectClose(undone.x, created.x)
  expectClose(undone.y, created.y)

  await page.keyboard.press('Control+Shift+z')
  expectClose((await editor.blockById(created.id)).x, moved.x)

  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+y')
  expectClose((await editor.blockById(created.id)).x, moved.x)
})

test('five arrow nudges collapse into a single undo', async ({ page }) => {
  const editor = new Editor(page)
  const created = await editor.createBlockAt(300, 240)
  const centre = await editor.centerOf(created)
  await page.mouse.click(centre.x, centre.y)

  const before = (await editor.blockById(created.id)).x
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await editor.blockById(created.id)).x).toBe(before + 5)

  await page.keyboard.press('Control+z')
  expectClose((await editor.blockById(created.id)).x, before)
})

test('shift+arrow nudges by a whole grid step', async ({ page }) => {
  const editor = new Editor(page)
  const created = await editor.createBlockAt(300, 240)
  const centre = await editor.centerOf(created)
  await page.mouse.click(centre.x, centre.y)

  await page.keyboard.press('Shift+ArrowDown')
  expectClose((await editor.blockById(created.id)).y, created.y + 20)
})

test('deleting a block cascades its arrow, and undo restores both', async ({ page }) => {
  const editor = new Editor(page)
  const source = await editor.createBlockAt(300, 240)
  const target = await editor.createBlockAt(620, 460)
  await editor.connect(source.id, target.id)
  expect(await editor.connectionIds()).toHaveLength(1)

  const centre = await editor.centerOf(source)
  await page.mouse.click(centre.x, centre.y)
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await editor.blocks()).length).toBe(1)
  expect(await editor.connectionIds()).toHaveLength(0)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await editor.blocks()).length).toBe(2)
  // The arrow has to come back too: a cascade that undo cannot reverse is a
  // silent data loss dressed up as a delete.
  expect(await editor.connectionIds()).toHaveLength(1)
})

test('paste gives the copy new ids, and undo takes it away again', async ({ page }) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(320, 260)
  const centre = await editor.centerOf(block)
  await page.mouse.click(centre.x, centre.y)

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect.poll(async () => (await editor.blocks()).length).toBe(2)

  const ids = (await editor.blocks()).map((b) => b.id)
  expect(new Set(ids).size).toBe(2)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await editor.blocks()).length).toBe(1)
})

test('redo is dropped once a new edit branches off it', async ({ page }) => {
  const editor = new Editor(page)
  const block = await editor.createBlockAt(320, 260)
  const centre = await editor.centerOf(block)
  await editor.drag(centre, { x: centre.x + 100, y: centre.y })

  await page.keyboard.press('Control+z')
  expect((await editor.history()).redo?.disabled).toBe(false)

  await editor.createBlockAt(700, 500)
  // A redo replayed against a document that has moved on is exactly the branch
  // the history layer refuses to allow.
  expect((await editor.history()).redo?.disabled).toBe(true)
})
