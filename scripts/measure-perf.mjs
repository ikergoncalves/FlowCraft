/**
 * Measures FlowCraft on a diagram far larger than anyone would draw by hand.
 *
 * Run with `npm run measure:perf`. It builds nothing — run `npm run build`
 * first — and serves `dist/` through Vite's preview server, because the point
 * is to time the bundle a user actually loads. React's development build
 * renders every component twice under StrictMode; timing it would produce
 * numbers about a program nobody runs.
 *
 * **Every number here is a median of repeated samples**, printed with its
 * spread. A single sample off a headless Chrome sharing a machine with a
 * compiler is noise, and an optimisation judged against noise is a coin flip.
 *
 * The measurements, and what each one is actually asking:
 *
 *  - `seedRender` — replace the document with N blocks and wait for the frame
 *    that shows them. "How long does the editor take to draw a big diagram it
 *    has just been handed?"
 *  - `coldLoad` — reload with that diagram in IndexedDB and time from the
 *    document's first script to the frame that shows it. This is the number a
 *    user experiences when they open the tab, and it includes the bundle
 *    parse, the IndexedDB read and the validator.
 *  - `dragFrames` — frame-to-frame deltas while a block is dragged across the
 *    canvas. The interactive number: 16.7ms is one frame at 60Hz, and the
 *    tail matters more than the mean because a single 200ms frame is what a
 *    user calls "it stutters".
 *  - `selectLatency` — click to selection outline. The cheapest possible
 *    interaction, so it isolates the fixed cost of one re-render.
 *  - `saveSnapshot` — `toDocument`, which deep-clones the whole document on
 *    every auto-save. Measured against the 600ms debounce it has to fit in.
 *  - `domNodes` — how much SVG is actually in the page, which is the input
 *    every other number is a function of.
 */

import { withBrowser } from './browser-harness.mjs'

/** Mirrors `bigBlockId` in `src/dev/bigDiagram.ts`. */
const blockId = (index) => `perf-b-${String(index).padStart(5, '0')}`

/**
 * Size of the diagram to measure. Overridable, because the interesting
 * question is not one number but where the curve bends: 500 blocks is already
 * a large hand-drawn diagram, and if the editor is comfortable there the next
 * thing worth knowing is where it stops being comfortable.
 */
const BLOCKS = Number(process.env.PERF_BLOCKS ?? 500)
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS ?? 800)

/** A stopwatch installed before the app's first byte, for the cold-load number. */
const COLD_LOAD_PROBE = `
  window.__coldLoad = { start: performance.now(), done: null, target: 0 }
  const tick = () => {
    if (window.__coldLoad.done === null && window.__coldLoad.target > 0) {
      const painted = document.querySelectorAll('[data-block-id]').length
      if (painted >= window.__coldLoad.target) {
        window.__coldLoad.done = performance.now() - window.__coldLoad.start
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
`

/** Median, and the 95th percentile, of a list of samples. */
function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
  return {
    median: at(0.5) ?? 0,
    p95: at(0.95) ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
    count: sorted.length,
  }
}

const ms = (value) => `${value.toFixed(1)}ms`

function report(name, sample, note) {
  const s =
    typeof sample === 'number'
      ? { median: sample, p95: sample, max: sample, count: 1 }
      : sample
  const spread = s.count > 1 ? `  (p95 ${ms(s.p95)}, max ${ms(s.max)}, n=${s.count})` : ''
  console.log(
    `  ${name.padEnd(22)} ${ms(s.median).padStart(9)}${spread}${note ? `  — ${note}` : ''}`,
  )
}

/**
 * Times one page operation across the frame that paints it.
 *
 * `mutate` is an expression that changes the document; the timer stops on the
 * first animation frame after the change, which is after React has rendered
 * and committed but before the compositor has finished — the closest thing to
 * "the work the main thread had to do" that a page can observe about itself.
 */
const timedFrame = (mutate) => `
  return await new Promise((resolve) => {
    const start = performance.now()
    ${mutate}
    requestAnimationFrame(() => { resolve(performance.now() - start) })
  })
`

async function repeat(page, expression, times) {
  const samples = []
  for (let i = 0; i < times; i += 1) samples.push(await page.evaluate(expression))
  return stats(samples)
}

async function main() {
  const label = process.argv[2] ?? 'measurement'
  console.log(`\nFlowCraft performance — ${label}`)
  console.log(`  ${BLOCKS} blocks, ${CONNECTIONS} connections, production bundle\n`)

  await withBrowser(
    async (page) => {
      await page.resize(1280, 900)

      /* -- Seed-to-paint, repeated: seed empty, then seed full, and time the full one. */
      const seedRender = await repeat(
        page,
        timedFrame(`
          window.__flowcraft.seed({ blocks: 0, connections: 0 })
          window.__flowcraft.seed({ blocks: ${BLOCKS}, connections: ${CONNECTIONS} })
        `),
        9,
      )

      const counts = await page.evaluate(`return window.__flowcraft.count()`)
      const rendered = await page.evaluate(`return window.__flowcraft.rendered()`)
      const domNodes = await page.evaluate(
        `return document.querySelector('[data-testid="canvas"]').getElementsByTagName('*').length`,
      )

      /* -- Cold load: let the seeded document reach IndexedDB, then reload. */
      await page.evaluate(`
        return new Promise((resolve) => { setTimeout(resolve, 1200) })
      `)
      const coldLoads = []
      for (let i = 0; i < 3; i += 1) {
        await page.reload()
        await page.evaluate(`window.__coldLoad.target = 1; return true`)
        const value = await page.evaluate(`
          return await new Promise((resolve) => {
            const poll = () => {
              if (window.__coldLoad.done !== null) resolve(window.__coldLoad.done)
              else requestAnimationFrame(poll)
            }
            poll()
          })
        `)
        coldLoads.push(value)
      }

      /* -- Interaction, on the reloaded page with the diagram restored. */
      await page.evaluate(
        `window.__flowcraft.setViewport({ x: 0, y: 0, zoom: 1 }); return true`,
      )
      await page.settle()

      const first = await page.evaluate(`
        const node = document.querySelector('[data-block-id="${blockId(0)}"] rect')
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      if (!first) throw new Error('The first seeded block is not on screen')

      /*
       * Selection latency, driven from inside the page.
       *
       * A CDP-driven click would work, but each dispatch is a websocket round
       * trip, and at this scale the round trip is the same order as the thing
       * being measured. Synthesising the pointer event in the page keeps the
       * real handler, the real hit test and the real re-render, and drops the
       * transport out of the number. The canvas takes no pointer capture, so a
       * synthetic event travels exactly the path a real one does.
       */
      const selectSamples = []
      for (let i = 0; i < 9; i += 1) {
        selectSamples.push(
          await page.evaluate(`
            // The i-th block that is actually rendered, not the i-th in the
            // document: past a few hundred blocks most of the document is
            // culled, and a probe naming a culled block finds nothing.
            const node = document.querySelectorAll('[data-block-id]')[${i}]
            const target = node && node.querySelector('rect')
            if (!target) throw new Error('fewer than ' + (${i} + 1) + ' blocks are rendered')
            const box = target.getBoundingClientRect()
            const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
            return await new Promise((resolve) => {
              const start = performance.now()
              target.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
                button: 0, buttons: 1, ...at,
              }))
              requestAnimationFrame(() => { resolve(performance.now() - start) })
            })
          `),
        )
        await page.evaluate(`
          document.querySelector('[data-testid="canvas"]').dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }),
          )
          return true
        `)
        await page.settle()
      }

      /* Drag frames: sample rAF deltas while one block is dragged. */
      const beforeDrag = await page.evaluate(
        `return document.querySelector('[data-block-id="${blockId(0)}"] rect').getAttribute('x')`,
      )
      await page.click(first.x, first.y)
      await page.evaluate(`
        window.__frames = []
        let last = performance.now()
        window.__sampling = true
        const tick = (now) => {
          if (!window.__sampling) return
          window.__frames.push(now - last)
          last = now
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        return true
      `)
      await page.drag(first, { x: first.x + 420, y: first.y + 260 }, { steps: 40 })
      const afterDrag = await page.evaluate(
        `return document.querySelector('[data-block-id="${blockId(0)}"] rect').getAttribute('x')`,
      )
      // A drag that did not drag would report a flawless 60fps of doing
      // nothing, which is the most convincing wrong number this script could
      // produce.
      if (Number(afterDrag) - Number(beforeDrag) < 300) {
        throw new Error(
          `The drag did not move the block: x went ${beforeDrag} -> ${afterDrag}`,
        )
      }
      const dragFrames = stats(
        (await page.evaluate(`window.__sampling = false; return window.__frames`))
          // The first delta spans the gap before the drag started.
          .slice(1),
      )

      /* Save snapshot: what `toDocument` costs, on this document, per write. */
      const saveSnapshot = await repeat(
        page,
        `return window.__flowcraft.snapshotCost(20)`,
        5,
      )

      console.log('  document')
      console.log(`    blocks ${counts.blocks}, connections ${counts.connections}`)
      console.log(
        `    rendered: ${rendered.blocks} blocks, ${rendered.connections} connections`,
      )
      console.log(`    SVG elements in the canvas: ${domNodes}\n`)
      console.log('  timings')
      report('seedRender', seedRender, 'replace document -> painted frame')
      report('coldLoad', stats(coldLoads), 'navigation -> diagram on screen')
      report('selectLatency', stats(selectSamples), 'click -> selection outline')
      report('dragFrames', dragFrames, 'frame-to-frame during a drag')
      report('saveSnapshot', saveSnapshot, 'toDocument, once per auto-save')
      console.log('')

      return {
        seedRender,
        coldLoads,
        selectSamples,
        dragFrames,
        saveSnapshot,
        counts,
        rendered,
        domNodes,
      }
    },
    { serve: 'preview', onPage: (page) => page.addInitScript(COLD_LOAD_PROBE) },
  )
}

await main()
