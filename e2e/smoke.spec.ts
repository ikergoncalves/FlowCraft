import { expect, test } from '@playwright/test'
import { downloadBytes, downloadFrom, Editor } from './editor'

/**
 * One pass over everything the app needs from its host, meant to be run
 * against the deployed site as well as against the dev server:
 *
 *     E2E_BASE_URL=https://… npx playwright test smoke
 *
 * The other specs check that FlowCraft is correct. This one checks that a
 * *deployment* of it works, which is a different question with different ways
 * of failing. The editor leans on four things a static host can quietly take
 * away: a secure context (IndexedDB and `createImageBitmap` are gated on it), a
 * Content-Security-Policy permissive enough for the blob URLs the rasteriser
 * builds and the data URL it loads the SVG through, correct MIME types for the
 * module scripts, and history fallback for the SPA. Every one of those is
 * invisible on localhost and fatal in production.
 *
 * It is deliberately short and end-to-end: create, connect, style, undo,
 * export, theme, reload. If this passes against a URL, the link in the README
 * is a link to a working editor.
 */

test('the deployed editor draws, saves, exports and survives a reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const editor = await Editor.open(page)
  await editor.disableSnap()

  /* -- The host gave us a secure context, or none of the rest can work. */
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true)
  expect(await page.evaluate(() => typeof indexedDB === 'object')).toBe(true)
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'unavailable',
  )

  /* -- Draw something. */
  const source = await editor.createBlockAt(280, 220)
  const target = await editor.createBlockAt(660, 400)
  await editor.connect(source.id, target.id)
  expect(await editor.connectionIds()).toHaveLength(1)

  /* -- Style it, which exercises the generated stylesheet and the cascade. */
  await editor.clickBlock(source.id)
  await editor.clickSwatch('#e2683c')
  expect((await editor.blockPaint(source.id))?.fill).toBe('rgb(226, 104, 60)')

  /* -- Undo it. */
  await page.keyboard.press('Control+z')
  expect((await editor.blockPaint(source.id))?.hasInlineFill).toBe(false)
  await page.keyboard.press('Control+y')

  /* -- Group, which is the last of the three element kinds. */
  await editor.groupBlocks(source.id, target.id)

  /* -- Themes: a CSP that blocked the injected <style> would show up here. */
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.getByTestId('theme-toggle').click()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(
    before,
  )

  /* -- Export: blob URLs, a data URL, and a canvas the host must not block. */
  const bytes = await downloadBytes(await downloadFrom(page, 'export-png-2x'))
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.length).toBeGreaterThan(1000)

  /* -- And it is all still there after a reload. */
  await expect
    .poll(
      async () => {
        const stored = await editor.stored()
        const document = stored.document as { blocks?: object } | null
        return Object.keys(document?.blocks ?? {}).length
      },
      { timeout: 8000 },
    )
    .toBe(2)

  await page.reload()
  await expect(page.getByTestId('storage-status')).not.toHaveAttribute(
    'data-status',
    'loading',
  )
  expect(await editor.blocks()).toHaveLength(2)
  expect(await editor.connectionIds()).toHaveLength(1)

  // Nothing shouted on the way through. A CSP violation reports itself here
  // and nowhere else.
  expect(errors).toEqual([])
})

test('a deep link falls back to the app rather than a 404', async ({ page }) => {
  // A single-page app served from static hosting needs the host to rewrite
  // unknown paths onto index.html. Without it, a shared link or a refresh on
  // any path but "/" lands on the host's own error page.
  const response = await page.goto('/some/deep/path')
  expect(response?.status()).toBe(200)
  await expect(page.getByTestId('canvas')).toBeVisible()
})
