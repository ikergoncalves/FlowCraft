import { expect, test } from '@playwright/test'
import { Editor } from './editor'

/**
 * Storage against the real IndexedDB.
 *
 * jsdom has no IndexedDB, which is why the whole storage layer sits behind an
 * injectable driver and every unit test runs against an in-memory one. That
 * leaves exactly one claim untested by construction — that the *real* driver
 * works — and this is where it is made. A reload is the strongest form of the
 * question: the store, the history and the clipboard are all gone with the
 * process, and only what actually reached disk comes back.
 */

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
})

/**
 * Waits for the auto-save to land, then hands back what it wrote.
 *
 * Polled rather than slept past the 600ms debounce: a flat sleep is how a
 * harness becomes flaky on a machine slower than the one it was written on.
 */
async function storedWith(editor: Editor, blocks: number) {
  await expect
    .poll(
      async () => {
        const state = await editor.stored()
        const document = state.document as { blocks?: object } | null
        return Object.keys(document?.blocks ?? {}).length
      },
      { timeout: 6000 },
    )
    .toBe(blocks)
  return editor.stored()
}

test('the editor opens with storage working rather than degraded', async ({ page }) => {
  expect(await page.evaluate(() => typeof indexedDB === 'object')).toBe(true)
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'unavailable',
  )
})

test('the document reaches IndexedDB, versioned, with its groups', async ({ page }) => {
  const editor = new Editor(page)
  const first = await editor.createBlockAt(300, 260)
  const second = await editor.createBlockAt(700, 260)
  await editor.groupBlocks(first.id, second.id)

  const stored = await storedWith(editor, 2)

  const document = stored.document as {
    version?: number
    groups?: object
    viewport?: unknown
    theme?: unknown
  }
  expect(document.version).toBe(1)
  expect(Object.keys(document.groups ?? {})).toHaveLength(1)
  // Preferences live under their own key. A document carrying the viewport
  // would make a pan a document write, which is the thing the auto-save was
  // built around not doing.
  expect(document.viewport).toBeUndefined()
  expect(document.theme).toBeUndefined()
  expect(stored.preferences).not.toBeNull()
})

test('the diagram, its ids and the theme all survive a reload', async ({ page }) => {
  const editor = new Editor(page)
  await editor.createBlockAt(300, 260)
  await editor.createBlockAt(700, 260)
  await page.keyboard.press('l')
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)

  const before = (await editor.blocks()).map(({ id, x, y, text }) => ({ id, x, y, text }))
  await storedWith(editor, 2)

  await page.reload()
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'loading',
  )

  const after = (await editor.blocks()).map(({ id, x, y, text }) => ({ id, x, y, text }))
  // Ids included: a restore that renumbered them would leave every arrow
  // pointing at a block that no longer exists under that name.
  expect(after).toEqual(before)
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
})

test('a restore is not an edit, so there is nothing to undo', async ({ page }) => {
  const editor = new Editor(page)
  await editor.createBlockAt(300, 260)
  await storedWith(editor, 1)

  await page.reload()
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'loading',
  )
  // Offering to undo an edit made in a session the user cannot remember —
  // which would empty the canvas — has no meaning at all.
  expect((await editor.history()).undo?.disabled).toBe(true)
})

test('clearing empties the canvas and the store, and it stays gone', async ({ page }) => {
  const editor = new Editor(page)
  await editor.createBlockAt(300, 260)
  await storedWith(editor, 1)

  page.on('dialog', (dialog) => void dialog.accept())
  await page.getByTestId('clear-storage').click()

  await expect.poll(async () => (await editor.blocks()).length).toBe(0)
  await expect
    .poll(async () => (await editor.stored()).document, { timeout: 6000 })
    .toBeNull()

  // Wiping storage alone would be a button that undid itself: the next
  // keystroke would save the still-open diagram straight back over the gap.
  await page.reload()
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'loading',
  )
  expect(await editor.blocks()).toHaveLength(0)
})
