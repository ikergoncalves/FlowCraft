/**
 * Drives FlowCraft in a real headless Chrome and checks the gestures and
 * history behaviours that jsdom cannot honestly exercise.
 *
 * Run with `npm run verify:browser`.
 *
 * Everything here is deliberately end-to-end and coordinate-exact: the point
 * is to catch the class of regression that unit tests structurally cannot see
 * — a dragged block trailing the cursor by the tap threshold (Phase 3), a
 * shortcut swallowed by the browser, a port that no longer appears on hover.
 * Failures print the expected and actual numbers and set a non-zero exit code.
 */

import { createChecklist, MODIFIER, withBrowser } from './browser-harness.mjs'

/** Reads every rendered block straight out of the SVG, in world units. */
const READ_BLOCKS = `
  return [...document.querySelectorAll('[data-block-id]')].map((node) => {
    const shape = node.querySelector('rect')
    return {
      id: node.dataset.blockId,
      x: Number(shape.getAttribute('x')),
      y: Number(shape.getAttribute('y')),
      width: Number(shape.getAttribute('width')),
      height: Number(shape.getAttribute('height')),
      text: node.querySelector('text').textContent,
    }
  })
`

const READ_CONNECTIONS = `
  return [...document.querySelectorAll('[data-connection-id]')].map((node) => ({
    id: node.dataset.connectionId,
  }))
`

const READ_HISTORY_BUTTONS = `
  const read = (id) => {
    const node = document.querySelector('[data-testid="' + id + '"]')
    return node ? { disabled: node.disabled, label: node.getAttribute('aria-label') } : null
  }
  return { undo: read('undo'), redo: read('redo') }
`

const READ_CANVAS_BOX = `
  const box = document.querySelector('[data-testid="canvas"]').getBoundingClientRect()
  return { left: box.left, top: box.top, width: box.width, height: box.height }
`

/**
 * The properties panel's shape, plus its box in client pixels.
 *
 * The box is the point: jsdom has no layout, so "the panel does not cover the
 * canvas and does not fall off a narrow window" is a question only a real
 * renderer can answer.
 */
const READ_PANEL = `
  const panel = document.querySelector('[data-testid="properties-panel"]')
  if (!panel) return null
  const box = panel.getBoundingClientRect()
  const view = document.documentElement
  return {
    blocks: !!panel.querySelector('[data-testid="block-properties"]'),
    connections: !!panel.querySelector('[data-testid="connection-properties"]'),
    mixed: panel.querySelectorAll('[data-testid="mixed-indicator"]').length,
    swatches: panel.querySelectorAll('[data-testid="swatch"]').length,
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
    insideViewport: box.right <= view.clientWidth + 0.5 && box.bottom <= view.clientHeight + 0.5,
  }
`

/**
 * What the browser actually paints for the first block — resolved through the
 * cascade, which is the one thing `getComputedStyle` can tell us and no unit
 * test can.
 */
const READ_BLOCK_PAINT = `
  const shape = document.querySelector('.block__shape')
  if (!shape) return null
  const style = getComputedStyle(shape)
  return {
    fill: style.fill,
    stroke: style.stroke,
    hasInlineFill: shape.style.fill !== '',
  }
`

const READ_ARROW_MARKERS = `
  const markers = [...document.querySelectorAll('[data-testid="arrow-marker"]')]
  const line = document.querySelector('.connection__line')
  return {
    count: markers.length,
    ids: markers.map((node) => node.id),
    markerEnd: line ? line.getAttribute('marker-end') : null,
    lineStroke: line ? getComputedStyle(line).stroke : null,
    arrowFill: markers
      .map((node) => getComputedStyle(node.querySelector('path')).fill),
  }
`

const READ_GROUP_CHROME = `
  const outlines = [...document.querySelectorAll('[data-testid="group-bounds"]')]
  return {
    groupBoxes: outlines.length,
    selectionBoxes: document.querySelectorAll('[data-testid="selection-bounds"]').length,
    selected: document.querySelectorAll('[data-testid="block-selection"]').length,
    stroke: outlines[0] ? getComputedStyle(outlines[0]).stroke : null,
  }
`

async function main() {
  const check = createChecklist()

  await withBrowser(async (page) => {
    const canvas = await page.evaluate(READ_CANVAS_BOX)
    /** World -> screen at the default viewport (origin 0,0 and zoom 1). */
    const screen = (x, y) => ({ x: canvas.left + x, y: canvas.top + y })
    const blocks = () => page.evaluate(READ_BLOCKS)
    const connections = () => page.evaluate(READ_CONNECTIONS)
    const centerOf = (block) =>
      screen(block.x + block.width / 2, block.y + block.height / 2)

    // Snapping would round every expected coordinate onto the grid and stop
    // these checks from measuring pointer tracking at all.
    await page.press('g')
    check.ok(
      'G turns snapping off',
      await page.evaluate(
        `return document.querySelector('[title^="Snap to grid"]').getAttribute('aria-pressed') === 'false'`,
      ),
      'Snap button still reads pressed',
    )

    console.log('\nHistory UI')
    const initial = await page.evaluate(READ_HISTORY_BUTTONS)
    check.ok('undo button exists', initial.undo, 'no [data-testid="undo"] in the toolbar')
    check.ok('redo button exists', initial.redo, 'no [data-testid="redo"] in the toolbar')
    check.equal('undo starts disabled', initial.undo?.disabled, true)
    check.equal('redo starts disabled', initial.redo?.disabled, true)
    check.equal('undo starts unlabelled', initial.undo?.label, 'Undo')

    console.log('\nBlock creation')
    await page.press('r')
    await page.click(canvas.left + 300, canvas.top + 240)
    let current = await blocks()
    check.equal('one block exists', current.length, 1)
    const created = { ...current[0] }

    const afterCreate = await page.evaluate(READ_HISTORY_BUTTONS)
    check.equal('undo enables after a create', afterCreate.undo?.disabled, false)
    check.equal('undo labels the create', afterCreate.undo?.label, 'Undo: Add block')

    console.log('\nDrag tracking (the Phase 3 regression this harness exists for)')
    const start = centerOf(created)
    const travel = { x: 187, y: 123 }
    await page.drag(start, { x: start.x + travel.x, y: start.y + travel.y })
    current = await blocks()
    // Exact, not approximate: @use-gesture's `movement` latches the tap
    // threshold and would leave this 3px short forever.
    check.close(
      'block x tracks the cursor exactly',
      current[0].x,
      created.x + travel.x,
      0.01,
    )
    check.close(
      'block y tracks the cursor exactly',
      current[0].y,
      created.y + travel.y,
      0.01,
    )

    const moved = { ...current[0] }
    const afterDrag = await page.evaluate(READ_HISTORY_BUTTONS)
    check.equal('undo labels the move', afterDrag.undo?.label, 'Undo: Move block')

    console.log('\nUndo / redo of a drag')
    await page.press('z', MODIFIER.ctrl)
    current = await blocks()
    check.close('ctrl+z restores x', current[0].x, created.x, 0.01)
    check.close('ctrl+z restores y', current[0].y, created.y, 0.01)

    await page.press('z', MODIFIER.ctrl | MODIFIER.shift)
    current = await blocks()
    check.close('ctrl+shift+z reapplies x', current[0].x, moved.x, 0.01)
    check.close('ctrl+shift+z reapplies y', current[0].y, moved.y, 0.01)

    await page.press('z', MODIFIER.ctrl)
    await page.press('y', MODIFIER.ctrl)
    current = await blocks()
    check.close('ctrl+y redoes as well', current[0].x, moved.x, 0.01)

    console.log('\nArrow nudge and merge')
    const beforeNudge = (await blocks())[0].x
    for (let i = 0; i < 5; i += 1) await page.press('ArrowRight')
    current = await blocks()
    check.close('five nudges move five units', current[0].x, beforeNudge + 5, 0.01)
    await page.press('z', MODIFIER.ctrl)
    current = await blocks()
    check.close('one undo takes back all five', current[0].x, beforeNudge, 0.01)

    await page.press('ArrowDown', MODIFIER.shift)
    current = await blocks()
    check.close('shift+arrow nudges by the grid step', current[0].y, moved.y + 20, 0.01)
    await page.press('z', MODIFIER.ctrl)

    console.log('\nConnections')
    // A second block to wire to, well clear of the first.
    await page.press('r')
    await page.click(canvas.left + 620, canvas.top + 460)
    current = await blocks()
    check.equal('two blocks exist', current.length, 2)
    const source = current.find((block) => block.id === created.id)
    const target = current.find((block) => block.id !== created.id)

    // Ports only render while the pointer is over a block, so hover first and
    // then read the port's real position out of the DOM.
    await page.mouse('mouseMoved', centerOf(source))
    await page.settle()
    const port = await page.evaluate(`
      const node = document.querySelector('[data-port-side="e"][data-port-block="${source.id}"] circle')
      if (!node) return null
      return { x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }
    `)
    check.ok('hovering a block reveals its east port', port, 'no port rendered on hover')

    if (port) {
      await page.drag(screen(port.x, port.y), centerOf(target), { steps: 16 })
      check.equal('the drag created a connection', (await connections()).length, 1)

      await page.press('z', MODIFIER.ctrl)
      check.equal('undo removes the connection', (await connections()).length, 0)
      check.equal('undo left both blocks alone', (await blocks()).length, 2)
      await page.press('y', MODIFIER.ctrl)
      check.equal('redo puts the connection back', (await connections()).length, 1)
    }

    console.log('\nDelete cascade and its undo')
    await page.click(centerOf(source).x, centerOf(source).y)
    await page.press('Delete')
    check.equal('deleting the block removes it', (await blocks()).length, 1)
    check.equal('and cascades its connection', (await connections()).length, 0)
    await page.press('z', MODIFIER.ctrl)
    check.equal('undo restores the block', (await blocks()).length, 2)
    check.equal('undo restores the cascaded connection', (await connections()).length, 1)

    console.log('\nCopy / paste with id remapping')
    await page.press('c', MODIFIER.ctrl)
    await page.press('v', MODIFIER.ctrl)
    const pasted = await blocks()
    check.equal('paste added one block', pasted.length, 3)
    check.equal(
      'pasted ids are new',
      new Set(pasted.map((block) => block.id)).size,
      pasted.length,
    )
    await page.press('z', MODIFIER.ctrl)
    check.equal('undo removes the pasted block', (await blocks()).length, 2)

    console.log('\nEscape mid-drag records nothing')
    const beforeEscape = (await blocks()).find((block) => block.id === target.id)
    const from = centerOf(beforeEscape)
    await page.mouse('mousePressed', { ...from, buttons: 1 })
    await page.mouse('mouseMoved', { x: from.x + 90, y: from.y + 40, buttons: 1 })
    await page.press('Escape')
    await page.mouse('mouseReleased', { x: from.x + 90, y: from.y + 40, buttons: 0 })
    await page.settle()
    const afterEscape = (await blocks()).find((block) => block.id === target.id)
    check.close('escape rewinds the drag', afterEscape.x, beforeEscape.x, 0.01)
    const escapeLabel = await page.evaluate(READ_HISTORY_BUTTONS)
    check.ok(
      'escape recorded no history entry',
      escapeLabel.undo?.label !== 'Undo: Move block',
      `undo still offers "${escapeLabel.undo?.label}"`,
    )

    /*
     * Phase 5 — styling and grouping.
     *
     * A clean slate first: whatever the checks above left behind would make the
     * counting assertions below depend on their order.
     */
    console.log('\nProperties panel')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')
    check.equal('the canvas is empty again', (await blocks()).length, 0)
    check.equal('and the panel is gone with it', await page.evaluate(READ_PANEL), null)

    await page.press('r')
    await page.click(canvas.left + 220, canvas.top + 200)
    await page.press('r')
    await page.click(canvas.left + 560, canvas.top + 200)
    current = await blocks()
    check.equal('two fresh blocks', current.length, 2)
    const one = { ...current[0] }
    const two = { ...current[1] }

    await page.click(centerOf(one).x, centerOf(one).y)
    let panel = await page.evaluate(READ_PANEL)
    check.ok('selecting a block reveals the panel', panel, 'no panel rendered')
    check.equal('it shows the block section', panel?.blocks, true)
    check.equal('and no connection section', panel?.connections, false)
    check.ok(
      'it renders its palette',
      panel?.swatches >= 8,
      `${panel?.swatches} swatches`,
    )

    // Layout facts jsdom cannot produce: the panel has a real box, it is fully
    // on screen, and it leaves most of the canvas uncovered.
    check.ok('the panel has a real box', panel?.width > 0 && panel?.height > 0)
    check.equal('it sits inside the viewport', panel?.insideViewport, true)
    check.ok(
      'it leaves the canvas mostly clear',
      panel?.width < canvas.width * 0.4,
      `panel is ${panel?.width}px of a ${canvas.width}px canvas`,
    )

    console.log('\nStyling a block for real')
    const paintBefore = await page.evaluate(READ_BLOCK_PAINT)
    check.equal(
      'an unstyled block sets no inline fill',
      paintBefore?.hasInlineFill,
      false,
    )
    check.ok(
      'and still paints from the stylesheet',
      paintBefore?.fill && paintBefore.fill !== 'none',
      `computed fill was "${paintBefore?.fill}"`,
    )

    const swatchBox = await page.evaluate(`
      const node = document.querySelector('[data-swatch="#e2683c"]')
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    `)
    check.ok('the palette offers the orange swatch', swatchBox, 'no swatch found')

    if (swatchBox) {
      await page.click(swatchBox.x, swatchBox.y)
      const painted = await page.evaluate(READ_BLOCK_PAINT)
      // The real cascade, not an attribute read: this is the only place that
      // can prove the attribute actually beat the class.
      check.equal('the block really paints orange', painted?.fill, 'rgb(226, 104, 60)')
      check.equal('the inline fill is now set', painted?.hasInlineFill, true)

      const styled = await page.evaluate(READ_HISTORY_BUTTONS)
      check.equal('the edit is one entry', styled.undo?.label, 'Undo: Set fill')

      await page.press('z', MODIFIER.ctrl)
      const reverted = await page.evaluate(READ_BLOCK_PAINT)
      check.equal('undo takes the inline fill away again', reverted?.hasInlineFill, false)
      check.equal(
        'and the stylesheet colour comes back',
        reverted?.fill,
        paintBefore?.fill,
      )
      await page.press('y', MODIFIER.ctrl)
    }

    console.log('\nMixed values across a selection')
    // The second block was never styled, so with the first one orange the two
    // genuinely disagree.
    await page.click(centerOf(two).x, centerOf(two).y)
    panel = await page.evaluate(READ_PANEL)
    check.equal('one block on its own reports no mixed value', panel?.mixed, 0)

    await page.press('a', MODIFIER.ctrl)
    panel = await page.evaluate(READ_PANEL)
    check.ok(
      'two differently filled blocks report a mixed value',
      panel?.mixed > 0,
      'no mixed indicator rendered',
    )

    console.log('\nColoured arrows and their markers')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')
    await page.press('r')
    await page.click(canvas.left + 220, canvas.top + 200)
    await page.press('r')
    await page.click(canvas.left + 620, canvas.top + 200)
    current = await blocks()
    const wireFrom = current[0]
    const wireTo = current[1]

    await page.mouse('mouseMoved', centerOf(wireFrom))
    await page.settle()
    const eastPort = await page.evaluate(`
      const node = document.querySelector('[data-port-side="e"][data-port-block="${wireFrom.id}"] circle')
      if (!node) return null
      return { x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }
    `)

    if (eastPort) {
      await page.drag(screen(eastPort.x, eastPort.y), centerOf(wireTo), { steps: 16 })
      check.equal('an arrow was drawn', (await connections()).length, 1)

      const before = await page.evaluate(READ_ARROW_MARKERS)
      check.equal('an unstyled diagram defines one marker', before?.count, 1)

      // Select the arrow by clicking its midpoint, then colour it.
      const mid = await page.evaluate(`
        const box = document.querySelector('.connection__hit').getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      await page.click(mid.x, mid.y)
      panel = await page.evaluate(READ_PANEL)
      check.equal(
        'the panel switches to the connection section',
        panel?.connections,
        true,
      )
      check.equal('and drops the block section', panel?.blocks, false)

      const lineSwatch = await page.evaluate(`
        const field = [...document.querySelectorAll('[data-testid="swatch"]')]
          .find((node) => node.getAttribute('aria-label') === 'Line: #e2683c')
        if (!field) return null
        const box = field.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      `)
      check.ok('the connection section offers a line colour', lineSwatch, 'no swatch')

      if (lineSwatch) {
        await page.click(lineSwatch.x, lineSwatch.y)
        const after = await page.evaluate(READ_ARROW_MARKERS)

        check.equal(
          'the line really paints orange',
          after?.lineStroke,
          'rgb(226, 104, 60)',
        )
        check.equal(
          'the arrow points at the marker for its colour',
          after?.markerEnd,
          'url(#flowcraft-arrow-e2683c)',
        )
        // The anti-explosion property, measured in the DOM: default + one
        // derived marker, not one marker per connection.
        check.equal('one marker per colour, plus the default', after?.count, 2)
        check.ok(
          'the arrowhead is painted the same orange',
          after?.arrowFill.includes('rgb(226, 104, 60)'),
          `arrow fills were ${JSON.stringify(after?.arrowFill)}`,
        )

        await page.press('z', MODIFIER.ctrl)
        const undone = await page.evaluate(READ_ARROW_MARKERS)
        check.equal('undo drops the derived marker again', undone?.count, 1)
      }
    }

    console.log('\nGrouping')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')
    await page.press('r')
    await page.click(canvas.left + 200, canvas.top + 200)
    await page.press('r')
    await page.click(canvas.left + 200, canvas.top + 420)
    await page.press('r')
    await page.click(canvas.left + 700, canvas.top + 200)
    current = await blocks()
    check.equal('three blocks to group', current.length, 3)
    const [first, second, third] = current

    await page.click(centerOf(first).x, centerOf(first).y)
    await page.click(centerOf(second).x, centerOf(second).y, MODIFIER.shift)
    await page.press('g', MODIFIER.ctrl)

    let chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('a group outline appears', chrome?.groupBoxes, 1)
    check.equal('and replaces the plain multi-selection box', chrome?.selectionBoxes, 0)
    check.ok(
      'the outline is painted a colour of its own',
      chrome?.stroke && chrome.stroke !== 'none',
      `computed stroke was "${chrome?.stroke}"`,
    )

    const grouped = await page.evaluate(READ_HISTORY_BUTTONS)
    check.equal('grouping is one entry', grouped.undo?.label, 'Undo: Group 2 blocks')

    // Click away, then click one member: the whole group must come back.
    await page.click(centerOf(third).x, centerOf(third).y)
    chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('clicking outside the group deselects it', chrome?.selected, 1)

    await page.click(centerOf(first).x, centerOf(first).y)
    chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('clicking one member selects both', chrome?.selected, 2)
    check.equal('and the group outline is back', chrome?.groupBoxes, 1)

    console.log('\nMoving a group')
    const groupBefore = (await blocks()).filter(
      (block) => block.id === first.id || block.id === second.id,
    )
    await page.drag(centerOf(first), {
      x: centerOf(first).x + 130,
      y: centerOf(first).y + 70,
    })
    const groupAfter = await blocks()
    for (const original of groupBefore) {
      const moved = groupAfter.find((block) => block.id === original.id)
      check.close(
        `${original.id} moved with the group in x`,
        moved.x,
        original.x + 130,
        0.01,
      )
      check.close(
        `${original.id} moved with the group in y`,
        moved.y,
        original.y + 70,
        0.01,
      )
    }
    const unmoved = groupAfter.find((block) => block.id === third.id)
    check.close('the block outside the group stayed put', unmoved.x, third.x, 0.01)

    // Re-read every position: the group has just moved, and the coordinates
    // captured before the drag now point at empty canvas.
    const placed = (id) => {
      const block = groupAfter.find((entry) => entry.id === id)
      return centerOf(block)
    }

    console.log('\nStepping into a group')
    await page.doubleClick(placed(first.id).x, placed(first.id).y)
    chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('double-click singles out one member', chrome?.selected, 1)
    check.equal('and the group outline goes', chrome?.groupBoxes, 0)

    console.log('\nDeleting and ungrouping')
    await page.click(placed(third.id).x, placed(third.id).y)
    await page.click(placed(first.id).x, placed(first.id).y)
    await page.press('Delete')
    check.equal('deleting a group takes both members', (await blocks()).length, 1)
    await page.press('z', MODIFIER.ctrl)
    check.equal('undo brings them back', (await blocks()).length, 3)
    chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('and the group with them', chrome?.groupBoxes, 1)

    await page.press('g', MODIFIER.ctrl | MODIFIER.shift)
    chrome = await page.evaluate(READ_GROUP_CHROME)
    check.equal('ctrl+shift+g dissolves the group', chrome?.groupBoxes, 0)
    check.equal('leaving an ordinary multi-selection', chrome?.selectionBoxes, 1)
    check.equal('with both blocks still there', (await blocks()).length, 3)

    /*
     * The narrow breakpoint, measured for the first time.
     *
     * `@media (width <= 560px)` was written in Phase 5 and never checked: this
     * harness ran at 1280x900, where the rule does not apply, and jsdom
     * evaluates no media queries at all. Everything below is a layout fact, so
     * this is the only place in the repository that can assert any of it.
     */
    console.log('\nNarrow viewport (400x800)')
    await page.resize(400, 800)
    const narrowCanvas = await page.evaluate(READ_CANVAS_BOX)
    const narrow = await page.evaluate(READ_PANEL)
    check.ok('the panel is still rendered', narrow, 'no panel at 400px')
    check.equal('it sits inside the viewport', narrow?.insideViewport, true)
    check.ok(
      'it spans the width as a bottom strip',
      narrow && narrow.width > narrowCanvas.width * 0.8,
      `panel is ${narrow?.width}px of a ${narrowCanvas.width}px canvas`,
    )
    check.ok(
      'it is anchored to the bottom, not the top',
      narrow && narrow.top > narrowCanvas.top + narrowCanvas.height / 2,
      `panel top is ${narrow?.top} in a canvas from ${narrowCanvas.top}`,
    )
    check.ok(
      'and still leaves most of the canvas uncovered',
      narrow && narrow.height < narrowCanvas.height * 0.5,
      `panel is ${narrow?.height}px tall over a ${narrowCanvas.height}px canvas`,
    )
    check.ok(
      'nothing overflows the page sideways',
      await page.evaluate(
        `return document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
      ),
      'the document scrolls horizontally at 400px',
    )
    check.ok(
      'the zoom indicator is not buried under the panel',
      await page.evaluate(`
        const zoom = document.querySelector('.zoom-indicator').getBoundingClientRect()
        const panel = document.querySelector('[data-testid="properties-panel"]').getBoundingClientRect()
        return zoom.bottom <= panel.top || zoom.top >= panel.bottom
      `),
      'the zoom indicator overlaps the properties panel',
    )
    check.ok(
      'every toolbar button is still reachable',
      await page.evaluate(`
        const bar = document.querySelector('.toolbar').getBoundingClientRect()
        return [...document.querySelectorAll('.toolbar button')].every((node) => {
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.left >= bar.left - 0.5 && box.right <= bar.right + 0.5
        })
      `),
      'a toolbar button is clipped at 400px',
    )
    await page.resetSize()
  })

  const { passed, failures } = check.summary()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
