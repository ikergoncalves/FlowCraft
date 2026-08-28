import { expect, test, type Page } from '@playwright/test'
import { Editor } from './editor'

/**
 * Themes, which are the clearest example of a claim that can only be checked
 * in a real renderer.
 *
 * jsdom loads no stylesheet and resolves no custom property through the
 * cascade, so "an unstyled block repaints and a painted one does not" is, in a
 * unit test, an assertion about two empty strings. Here it is
 * `getComputedStyle` on a browser that has actually applied the sheet.
 */

const ORANGE = '#e2683c'
const ORANGE_RGB = 'rgb(226, 104, 60)'

interface ThemeReading {
  theme: string
  colorScheme: string
  blockFillVar: string
  surfaceVar: string
  styleTags: number
  target: string
}

async function readTheme(page: Page): Promise<ThemeReading> {
  return page.evaluate(() => {
    const root = document.documentElement
    const toggle = document.querySelector<HTMLElement>('[data-testid="theme-toggle"]')
    return {
      theme: root.dataset.theme ?? '',
      colorScheme: root.style.colorScheme,
      blockFillVar: getComputedStyle(root).getPropertyValue('--block-fill').trim(),
      surfaceVar: getComputedStyle(root).getPropertyValue('--surface').trim(),
      styleTags: document.querySelectorAll('#flowcraft-theme').length,
      target: toggle?.dataset.themeTarget ?? '',
    }
  })
}

test.beforeEach(async ({ page }) => {
  const editor = await Editor.open(page)
  await editor.disableSnap()
  // Whatever the platform preference gave us, start from a known theme.
  if ((await readTheme(page)).theme !== 'dark') await page.keyboard.press('l')
})

test('the generated stylesheet is installed exactly once and resolves', async ({
  page,
}) => {
  const dark = await readTheme(page)
  expect(dark.styleTags).toBe(1)
  expect(dark.theme).toBe('dark')
  // The browser has to be told which way to paint its own widgets too.
  expect(dark.colorScheme).toBe('dark')
  expect(dark.blockFillVar.length).toBeGreaterThan(0)
  expect(dark.surfaceVar.length).toBeGreaterThan(0)
})

test('the theme reaches what the user did not paint, and only that', async ({ page }) => {
  const editor = new Editor(page)
  const plain = await editor.createBlockAt(240, 200)
  const painted = await editor.createBlockAt(620, 200)

  const centre = await editor.centerOf(painted)
  await page.mouse.click(centre.x, centre.y)
  await editor.clickSwatch(ORANGE)
  await page.keyboard.press('Escape')

  const darkPlain = await editor.blockPaint(plain.id)
  expect(darkPlain?.fill).toBeTruthy()
  expect(darkPlain?.fill).not.toBe('none')
  expect(darkPlain?.fill).not.toBe('rgb(0, 0, 0)')
  expect((await editor.blockPaint(painted.id))?.fill).toBe(ORANGE_RGB)

  await page.keyboard.press('l')
  expect((await readTheme(page)).theme).toBe('light')

  // The load-bearing pair.
  expect((await editor.blockPaint(plain.id))?.fill).not.toBe(darkPlain?.fill)
  expect((await editor.blockPaint(painted.id))?.fill).toBe(ORANGE_RGB)
})

test('the toggle works in both directions, not just once', async ({ page }) => {
  // The case an implicit `:root` default gets wrong: with no explicit
  // `[data-theme="dark"]` block, the light rules win on document order and the
  // toggle only ever works one way.
  const dark = await readTheme(page)

  await page.keyboard.press('l')
  const light = await readTheme(page)
  expect(light.theme).toBe('light')
  expect(light.target).toBe('dark')
  expect(light.blockFillVar).not.toBe(dark.blockFillVar)

  await page.getByTestId('theme-toggle').click()
  const back = await readTheme(page)
  expect(back.theme).toBe('dark')
  expect(back.blockFillVar).toBe(dark.blockFillVar)
})

test('switching theme is not an undoable edit', async ({ page }) => {
  const editor = new Editor(page)
  await editor.createBlockAt(300, 240)

  await page.keyboard.press('l')
  const { undo } = await editor.history()
  // The theme describes the viewer, not the document; undoing an edit must
  // never hand back a palette the user has moved on from.
  expect(undo?.label).toBe('Undo: Add block')
})
