/**
 * Records the README's demonstration GIF by driving the real editor.
 *
 * Run with `npm run capture:demo`. It serves the production build, performs a
 * scripted session in a headless Chrome, screenshots the viewport as it goes,
 * and encodes the frames into `docs/demo.gif`.
 *
 * **Nothing here is staged.** Every block is created by clicking the canvas,
 * every arrow by dragging from a port, every colour by clicking a swatch. The
 * GIF is a recording of the program, so it cannot drift away from what the
 * program does — a mocked-up animation would go stale the first time a control
 * moved and nobody would notice.
 *
 * The frames are captured on the same CDP rig that measures performance, which
 * is the second half of why that rig survived Phase 7's migration to
 * Playwright: a test runner isolates, retries and tears down between cases,
 * and a recording wants one long-lived page from the first frame to the last.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
// gifenc ships CommonJS, so it comes in through the default export.
import gifenc from 'gifenc'
import { sleep, withBrowser } from './browser-harness.mjs'

const { GIFEncoder, applyPalette, quantize } = gifenc

/** Capture size. Small enough for a README, large enough to read the labels. */
const WIDTH = 940
const HEIGHT = 600

/**
 * How much to shrink each frame before encoding.
 *
 * 1, i.e. not at all. Halving the frame also halves the 14px block labels,
 * and a demonstration nobody can read is not a demonstration. The file stays
 * reasonable because pauses are *durations* rather than repeated frames — see
 * `HOLD`.
 */
const SHRINK = 1

/** Milliseconds one frame of motion is shown for. */
const FRAME_DELAY = 70

/**
 * How long to rest on a moment, in milliseconds.
 *
 * Encoded as one frame with a long delay rather than as many identical frames.
 * The first version of this script held a beat by pushing the same screenshot
 * four times and produced 233 frames for a sixteen-second GIF; expressing the
 * same pacing as delays gives about ninety, which is what pays for rendering
 * at full size.
 */
const HOLD = { beat: 300, pause: 700, end: 1800 }

/**
 * Decodes a PNG screenshot and box-filters it down by `SHRINK`.
 *
 * Averaging rather than dropping pixels: a nearest-neighbour shrink turns the
 * one-pixel grid dots and the hairline connection strokes into a shimmering
 * mess, which is exactly the detail this diagram is made of.
 */
function shrinkFrame(buffer) {
  const png = PNG.sync.read(buffer)
  const width = Math.floor(png.width / SHRINK)
  const height = Math.floor(png.height / SHRINK)
  const out = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < SHRINK; dy += 1) {
        for (let dx = 0; dx < SHRINK; dx += 1) {
          const at = ((y * SHRINK + dy) * png.width + (x * SHRINK + dx)) * 4
          r += png.data[at]
          g += png.data[at + 1]
          b += png.data[at + 2]
        }
      }
      const samples = SHRINK * SHRINK
      const to = (y * width + x) * 4
      out[to] = Math.round(r / samples)
      out[to + 1] = Math.round(g / samples)
      out[to + 2] = Math.round(b / samples)
      out[to + 3] = 255
    }
  }

  return { data: out, width, height }
}

async function main() {
  const frames = []
  /** Which frame to keep as the static still. Set once, mid-demo. */
  let still = null

  await withBrowser(
    async (page) => {
      await page.resize(WIDTH, HEIGHT)

      /** Screenshots the viewport, to be shown for `delay` milliseconds. */
      const shoot = async (delay = FRAME_DELAY) => {
        frames.push({ png: await page.screenshot(), delay })
      }

      const canvas = await page.evaluate(`
        const box = document.querySelector('[data-testid="canvas"]').getBoundingClientRect()
        return { left: box.left, top: box.top, width: box.width, height: box.height }
      `)
      const at = (x, y) => ({ x: canvas.left + x, y: canvas.top + y })

      const readBlocks = `
        return [...document.querySelectorAll('[data-block-id]')].map((node) => {
          const shape = node.querySelector('rect')
          return {
            id: node.dataset.blockId,
            x: Number(shape.getAttribute('x')),
            y: Number(shape.getAttribute('y')),
            width: Number(shape.getAttribute('width')),
            height: Number(shape.getAttribute('height')),
          }
        })
      `
      const blocks = () => page.evaluate(readBlocks)
      const centre = (block) => at(block.x + block.width / 2, block.y + block.height / 2)

      /** A drag, screenshotting every step so the motion is in the GIF. */
      const filmedDrag = async (from, to, steps = 14) => {
        await page.mouse('mousePressed', { ...from, buttons: 1 })
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps
          await page.mouse('mouseMoved', {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
            buttons: 1,
          })
          await page.settle()
          await shoot()
        }
        await page.mouse('mouseReleased', { ...to, buttons: 0 })
        await page.settle()
        await shoot(HOLD.beat)
      }

      /* -- Open on an empty canvas. */
      await shoot(HOLD.pause)

      /* -- Draw three blocks. */
      const spots = [
        [200, 150],
        [560, 150],
        [560, 380],
      ]
      for (const [x, y] of spots) {
        await page.press('r')
        await shoot(HOLD.beat)
        const spot = at(x, y)
        await page.click(spot.x, spot.y)
        await shoot(HOLD.beat)
      }
      await shoot(HOLD.pause)

      /* -- Label them, by double-clicking and typing. */
      const labels = ['Idea', 'Draft', 'Ship']
      const placed = await blocks()
      for (let i = 0; i < placed.length; i += 1) {
        const spot = centre(placed[i])
        await page.doubleClick(spot.x, spot.y)
        await shoot(HOLD.beat)
        await page.typeText(labels[i])
        await shoot(HOLD.beat)
        // Enter commits; Escape would cancel and leave the label unchanged.
        await page.press('Enter')
        await shoot(HOLD.beat)
      }
      await shoot(HOLD.pause)

      /* -- Wire them together by dragging from a port. */
      const wired = await blocks()
      for (const [from, to] of [
        [0, 1],
        [1, 2],
      ]) {
        const source = wired[from]
        await page.mouse('mouseMoved', centre(source))
        await page.settle()
        await shoot(HOLD.beat)
        const port = await page.evaluate(`
          const node = document.querySelector('[data-port-side="e"][data-port-block="${source.id}"] .port__dot')
            ?? document.querySelector('[data-port-side="s"][data-port-block="${source.id}"] .port__dot')
          if (!node) return null
          return { x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }
        `)
        if (!port) continue
        await filmedDrag(at(port.x, port.y), centre(wired[to]), 12)
      }
      await shoot(HOLD.pause)

      /* -- Colour one of them. */
      const painted = (await blocks())[1]
      await page.click(centre(painted).x, centre(painted).y)
      await shoot(HOLD.pause)
      const swatch = await page.evaluate(`
        const node = document.querySelector('[data-swatch="#e2683c"]')
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      if (swatch) {
        await page.click(swatch.x, swatch.y)
        await shoot(HOLD.pause)
      }

      /* -- Group two of them and move the pair as one. */
      const toGroup = await blocks()
      await page.click(centre(toGroup[1]).x, centre(toGroup[1]).y)
      await page.click(centre(toGroup[2]).x, centre(toGroup[2]).y, 8)
      await shoot(HOLD.beat)
      await page.press('g', 2)
      await shoot(HOLD.pause)

      const grabbed = (await blocks())[1]
      const grab = centre(grabbed)
      await filmedDrag(grab, { x: grab.x + 150, y: grab.y - 40 }, 14)
      await shoot(HOLD.beat)

      /* -- Undo it, which puts the group back where it was. */
      await page.press('z', 2)
      await shoot(HOLD.pause)

      /* -- Switch the theme. */
      const toggle = await page.evaluate(`
        const box = document.querySelector('[data-testid="theme-toggle"]').getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      await page.click(toggle.x, toggle.y)
      await shoot(HOLD.pause)
      await page.click(toggle.x, toggle.y)
      await shoot(HOLD.beat)

      /*
       * A clean look at the finished diagram, with nothing selected and no
       * panel over it. This is the frame saved as the still: a GIF does not
       * animate in every context a README is read in, and the last frame —
       * a menu open over a properties panel — is a poor thing to fall back to.
       */
      const empty = at(140, 500)
      await page.click(empty.x, empty.y)
      await shoot(HOLD.pause)
      still = frames[frames.length - 1]

      /* -- And show that it exports. */
      const exportToggle = await page.evaluate(`
        const box = document.querySelector('[data-testid="export-toggle"]').getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      await page.click(exportToggle.x, exportToggle.y)
      await shoot(HOLD.end)

      await sleep(50)
    },
    { serve: 'preview' },
  )

  console.log(`Captured ${frames.length} frames; encoding…`)

  const encoder = GIFEncoder()
  let palette = null
  let size = null

  for (const { png, delay } of frames) {
    const frame = shrinkFrame(png)
    size ??= { width: frame.width, height: frame.height }
    /*
     * One palette for the whole GIF, taken from the first frame.
     *
     * Per-frame palettes look marginally better and triple the file size, and
     * this diagram is a handful of flat colours on two backgrounds — the first
     * frame already contains nearly all of them.
     */
    palette ??= quantize(frame.data, 256)
    const indexed = applyPalette(frame.data, palette)
    encoder.writeFrame(indexed, frame.width, frame.height, { palette, delay })
  }

  encoder.finish()
  await mkdir('docs', { recursive: true })
  if (still) await writeFile('docs/demo.png', still.png)
  const bytes = encoder.bytes()
  await writeFile('docs/demo.gif', bytes)
  console.log(
    `Wrote docs/demo.gif — ${size?.width}x${size?.height}, ${frames.length} frames, ${(bytes.length / 1024 / 1024).toFixed(2)}MB`,
  )
}

await main()
