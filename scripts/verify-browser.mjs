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

import { createChecklist, MODIFIER, sleep, withBrowser } from './browser-harness.mjs'

/**
 * Polls IndexedDB until the document holds `expected` blocks.
 *
 * A flat sleep past the 600ms debounce would work most of the time, which is
 * exactly the property that makes a harness flaky on a slower machine.
 */
async function waitForStored(page, read, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const stored = await read()
    if (stored?.document && Object.keys(stored.document.blocks).length === expected) {
      return stored
    }
    if (Date.now() > deadline) return stored
    await sleep(100)
  }
}

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
     * Phase 6 — themes.
     *
     * The only place the claim can be tested. jsdom loads no stylesheet and
     * resolves no custom property through the cascade, so "an unstyled block
     * repaints and a painted one does not" is, in a unit test, an assertion
     * about two empty strings. Here it is `getComputedStyle` on a real
     * renderer, which is also what caught the presentation-attribute bug in
     * Phase 5.
     */
    console.log('\nThemes')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')
    await page.press('r')
    await page.click(canvas.left + 240, canvas.top + 200)
    await page.press('r')
    await page.click(canvas.left + 620, canvas.top + 200)
    current = await blocks()
    const plainBlock = current[0]
    const paintedBlock = current[1]

    // Paint the second one orange, so the run has one block on the stylesheet
    // and one carrying its own colour.
    await page.click(centerOf(paintedBlock).x, centerOf(paintedBlock).y)
    const orange = await page.evaluate(`
      const node = document.querySelector('[data-swatch="#e2683c"]')
      const box = node.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    `)
    await page.click(orange.x, orange.y)
    await page.click(canvas.left + 60, canvas.top + 600)

    const readTheme = () =>
      page.evaluate(`
        const root = document.documentElement
        const shape = (id) => getComputedStyle(
          document.querySelector('[data-block-id="' + id + '"] .block__shape'),
        )
        const toolbar = document.querySelector('[data-testid="theme-toggle"]')
        return {
          theme: root.dataset.theme,
          colorScheme: root.style.colorScheme,
          blockFillVar: getComputedStyle(root).getPropertyValue('--block-fill').trim(),
          surfaceVar: getComputedStyle(root).getPropertyValue('--surface').trim(),
          plainFill: shape('${plainBlock.id}').fill,
          paintedFill: shape('${paintedBlock.id}').fill,
          target: toolbar.dataset.themeTarget,
          styleTags: document.querySelectorAll('#flowcraft-theme').length,
        }
      `)

    // Whatever the platform preference gave us, start from a known theme.
    let themeState = await readTheme()
    if (themeState.theme !== 'dark') await page.press('l')
    const dark = await readTheme()

    check.equal('the generated sheet is installed exactly once', dark.styleTags, 1)
    check.equal('the document opens on a named theme', dark.theme, 'dark')
    check.equal('and tells the browser which way to paint', dark.colorScheme, 'dark')
    check.ok(
      'the custom properties really resolve',
      dark.blockFillVar.length > 0 && dark.surfaceVar.length > 0,
      `--block-fill was "${dark.blockFillVar}"`,
    )
    check.ok(
      'an unstyled block paints from them',
      dark.plainFill && dark.plainFill !== 'none' && dark.plainFill !== 'rgb(0, 0, 0)',
      `computed fill was "${dark.plainFill}"`,
    )
    check.equal('the painted block is orange', dark.paintedFill, 'rgb(226, 104, 60)')

    await page.press('l')
    const light = await readTheme()
    check.equal('L switches the theme', light.theme, 'light')
    check.equal('the toggle now offers dark', light.target, 'dark')
    check.ok(
      'the custom property itself moved',
      light.blockFillVar !== dark.blockFillVar,
      `--block-fill stayed "${light.blockFillVar}"`,
    )
    // The load-bearing pair: the theme reaches what the user did not paint,
    // and only that.
    check.ok(
      'the unstyled block really repaints',
      light.plainFill !== dark.plainFill,
      `fill stayed "${light.plainFill}" across the swap`,
    )
    check.equal('the painted block does not', light.paintedFill, 'rgb(226, 104, 60)')

    const themedHistory = await page.evaluate(READ_HISTORY_BUTTONS)
    check.ok(
      'switching theme is not an undoable edit',
      themedHistory.undo?.label !== 'Undo: Switch theme',
      `undo offers "${themedHistory.undo?.label}"`,
    )

    // Back again, which is the case an implicit `:root` default gets wrong:
    // with no explicit `[data-theme='dark']` block, the light rules would win
    // on document order and the toggle would only work once.
    const toggle = await page.evaluate(`
      const box = document.querySelector('[data-testid="theme-toggle"]').getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    `)
    await page.click(toggle.x, toggle.y)
    const backToDark = await readTheme()
    check.equal('the toolbar button switches back', backToDark.theme, 'dark')
    check.equal(
      'and the palette comes back with it',
      backToDark.blockFillVar,
      dark.blockFillVar,
    )
    check.equal(
      'a painted block is still untouched',
      backToDark.paintedFill,
      dark.paintedFill,
    )

    /*
     * Phase 6 — export.
     *
     * The SVG is a pure function of the document and is tested exhaustively in
     * `src/export/svg.test.ts`; what cannot be tested there is rasterising,
     * because jsdom ships no canvas and no image decoder. So the checks below
     * run the exporter in the page and then answer the two questions a unit
     * test structurally cannot: does a real browser *decode* this markup, and
     * is the PNG it produces an actual picture rather than a blank rectangle.
     *
     * The blank-PNG case is the one that matters. A canvas that fails to draw
     * still hands back a perfectly valid, correctly-sized, entirely empty PNG,
     * and nothing short of reading the pixels can tell the difference.
     */
    console.log('\nExport')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')
    await page.press('r')
    await page.click(canvas.left + 260, canvas.top + 200)
    await page.press('r')
    await page.click(canvas.left + 640, canvas.top + 380)
    current = await blocks()

    // An arrow, so the export has a marker to carry.
    await page.mouse('mouseMoved', centerOf(current[0]))
    await page.settle()
    const exportPort = await page.evaluate(`
      const node = document.querySelector('[data-port-side="e"][data-port-block="${current[0].id}"] circle')
      if (!node) return null
      return { x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }
    `)
    if (exportPort) {
      await page.drag(screen(exportPort.x, exportPort.y), centerOf(current[1]), {
        steps: 16,
      })
    }
    check.equal('a diagram to export', (await connections()).length, 1)

    // Reach into the app's own exporter through the dev server's module graph:
    // this is the very function the toolbar calls, not a re-implementation.
    const exported = await page.evaluate(`
      return (async () => {
        const [{ exportSvg }, { renderPng }] = await Promise.all([
          import('/src/export/svg.ts'),
          import('/src/export/png.ts'),
        ])
        const { useDiagramStore } = await import('/src/store/diagramStore.ts')
        const { useThemeStore } = await import('/src/theme/themeStore.ts')

        const theme = useThemeStore.getState().theme
        const svg = exportSvg(useDiagramStore.getState(), { theme })
        if (!svg) return { svg: null }

        const blob = await renderPng(svg, { scale: 2, background: '#ffffff' })
        const bitmap = await createImageBitmap(blob)
        const probe = document.createElement('canvas')
        probe.width = bitmap.width
        probe.height = bitmap.height
        const context = probe.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

        // How many distinct colours the rasteriser actually put down. A blank
        // canvas has exactly one; a drawing has several.
        const colours = new Set()
        let opaque = 0
        for (let at = 0; at < data.length; at += 4) {
          if (data[at + 3] > 0) opaque += 1
          // Capped, not broken out of: the opacity tally has to see every
          // pixel, and an anti-aliased drawing has thousands of shades.
          if (colours.size <= 64) {
            colours.add(data[at] + ',' + data[at + 1] + ',' + data[at + 2])
          }
        }

        return {
          svg: svg.markup,
          width: svg.width,
          height: svg.height,
          pngBytes: blob.size,
          pngType: blob.type,
          pngWidth: bitmap.width,
          pngHeight: bitmap.height,
          distinctColours: colours.size,
          opaquePixels: opaque,
          totalPixels: data.length / 4,
        }
      })()
    `)

    check.ok('the exporter produced something', exported?.svg, 'export returned null')

    // Well-formedness, judged by a real XML parser rather than by a regex.
    const parsed = await page.evaluate(`
      const markup = ${JSON.stringify(exported?.svg ?? '')}
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
      const failed = doc.querySelector('parsererror')
      if (failed) return { ok: false, message: failed.textContent }
      const ids = [...doc.querySelectorAll('marker')].map((node) => node.id)
      const referenced = [...doc.querySelectorAll('[marker-end]')]
        .map((node) => node.getAttribute('marker-end').slice(5, -1))
      return {
        ok: true,
        root: doc.documentElement.tagName,
        blocks: doc.querySelectorAll('.block__shape').length,
        lines: doc.querySelectorAll('.connection__line').length,
        markers: ids,
        danglingMarkers: referenced.filter((id) => !ids.includes(id)),
        chrome: /canvas__grid|marquee|selection__|connection__hit|connection__halo|data-block-id|__ghost/.test(markup),
        hasStyleBlock: doc.querySelectorAll('style').length,
      }
    `)

    check.equal('the exported SVG is well-formed', parsed?.ok, true)
    check.equal('and its root is an svg', parsed?.root, 'svg')
    check.equal('it carries both blocks', parsed?.blocks, 2)
    check.equal('and the arrow', parsed?.lines, 1)
    check.equal('it carries no editing chrome', parsed?.chrome, false)
    check.equal('it embeds its stylesheet', parsed?.hasStyleBlock, 1)
    check.ok(
      'the marker the arrow points at is defined',
      parsed && parsed.markers.length > 0 && parsed.danglingMarkers.length === 0,
      `dangling: ${JSON.stringify(parsed?.danglingMarkers)}`,
    )

    console.log('\nRasterising')
    check.ok(
      'the PNG has bytes in it',
      exported?.pngBytes > 1000,
      `${exported?.pngBytes}B`,
    )
    check.equal('and is really a PNG', exported?.pngType, 'image/png')
    check.equal('2x doubles the width', exported?.pngWidth, exported?.width * 2)
    check.equal('2x doubles the height', exported?.pngHeight, exported?.height * 2)
    check.equal(
      'the background is opaque everywhere',
      exported?.opaquePixels,
      exported?.totalPixels,
    )
    // The check jsdom cannot make: this is not a correctly-sized blank image.
    check.ok(
      'the PNG is a drawing, not a blank rectangle',
      exported?.distinctColours > 3,
      `only ${exported?.distinctColours} distinct colours in the raster`,
    )

    console.log('\nThe export menu')
    const canvasTopBefore = (await page.evaluate(READ_CANVAS_BOX)).top
    const openExport = await page.evaluate(`
      const box = document.querySelector('[data-testid="export-toggle"]').getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, disabled: document.querySelector('[data-testid="export-toggle"]').disabled }
    `)
    check.equal(
      'the export button is live with a diagram open',
      openExport.disabled,
      false,
    )
    await page.click(openExport.x, openExport.y)
    const menu = await page.evaluate(`
      const node = document.querySelector('[data-testid="export-menu"]')
      if (!node) return null
      const box = node.getBoundingClientRect()
      const view = document.documentElement
      return {
        items: node.querySelectorAll('[role="menuitem"]').length,
        insideViewport: box.right <= view.clientWidth + 0.5 && box.bottom <= view.clientHeight + 0.5,
        reachesPastToolbar: box.bottom > document.querySelector('.toolbar').getBoundingClientRect().bottom,
        canvasTop: document.querySelector('[data-testid="canvas"]').getBoundingClientRect().top,
      }
    `)
    check.ok('it opens a menu', menu, 'no export menu rendered')
    check.equal('offering SVG and both PNG scales', menu?.items, 3)
    check.equal('drawn inside the window', menu?.insideViewport, true)
    // Floating over the canvas rather than pushing it down: a menu that took
    // part in the toolbar's flex row would move the diagram under the cursor.
    check.equal('reaching down over the canvas', menu?.reachesPastToolbar, true)
    check.close('without moving it', menu?.canvasTop, canvasTopBefore, 0.5)
    await page.press('Escape')
    check.ok(
      'escape closes it',
      !(await page.evaluate(
        `return !!document.querySelector('[data-testid="export-menu"]')`,
      )),
      'the menu stayed open',
    )

    /*
     * Phase 6 — persistence.
     *
     * IndexedDB does not exist in jsdom, which is why the storage layer sits
     * behind an injectable driver and every unit test runs against an
     * in-memory one. That leaves exactly one claim untested by construction:
     * that the *real* driver works. This is where it is made.
     */
    console.log('\nPersistence')
    await page.press('a', MODIFIER.ctrl)
    await page.press('Delete')

    const readStored = () =>
      page.evaluate(`
        return new Promise((resolve) => {
          const open = indexedDB.open('flowcraft', 1)
          open.onerror = () => { resolve({ error: String(open.error) }) }
          open.onsuccess = () => {
            const tx = open.result.transaction('state', 'readonly')
            const store = tx.objectStore('state')
            const doc = store.get('document')
            const prefs = store.get('preferences')
            tx.oncomplete = () => {
              open.result.close()
              resolve({ document: doc.result ?? null, preferences: prefs.result ?? null })
            }
          }
        })
      `)

    check.ok(
      'the page really has IndexedDB',
      await page.evaluate(`return typeof indexedDB === 'object'`),
    )
    check.ok(
      'the editor reports auto-save rather than a failure',
      await page.evaluate(`
        const chip = document.querySelector('[data-testid="storage-status"]')
        return chip && chip.dataset.status !== 'unavailable'
      `),
      'the storage chip says storage is unavailable',
    )

    await page.press('r')
    await page.click(canvas.left + 300, canvas.top + 260)
    await page.press('r')
    await page.click(canvas.left + 700, canvas.top + 260)
    const toPersist = await blocks()
    check.equal('two blocks to persist', toPersist.length, 2)

    // Group them, so the saved document has all three kinds of element in it.
    await page.press('a', MODIFIER.ctrl)
    await page.press('g', MODIFIER.ctrl)

    // The debounce is 600ms in the real app; wait past it rather than guessing.
    const stored = await waitForStored(page, readStored, 2)
    check.ok('the document reaches IndexedDB', stored?.document, 'nothing was stored')
    check.equal('it carries a version from the first save', stored?.document?.version, 1)
    check.equal(
      'and every element it should',
      stored ? Object.keys(stored.document.blocks).length : 0,
      2,
    )
    check.equal(
      'including the group',
      stored ? Object.keys(stored.document.groups).length : 0,
      1,
    )
    check.ok(
      'preferences are stored apart from the document',
      stored?.preferences && stored.preferences.theme !== undefined,
      'no preferences record',
    )
    check.ok(
      'and the document carries none of them',
      stored?.document?.viewport === undefined && stored?.document?.theme === undefined,
      'the document record carries UI preferences',
    )

    console.log('\nSurviving a reload')
    const beforeReload = (await blocks()).map((block) => ({
      id: block.id,
      x: block.x,
      y: block.y,
      text: block.text,
    }))
    await page.press('l')
    await page.settle()
    await sleep(900)

    await page.reload()
    const afterReload = (await blocks()).map((block) => ({
      id: block.id,
      x: block.x,
      y: block.y,
      text: block.text,
    }))
    check.equal(
      'the diagram comes back after a reload',
      JSON.stringify(afterReload),
      JSON.stringify(beforeReload),
    )
    check.equal(
      'ids survive too, so the arrows would still point somewhere',
      afterReload.every((block) => beforeReload.some((was) => was.id === block.id)),
      true,
    )
    check.equal(
      'the theme comes back with it',
      await page.evaluate(`return document.documentElement.dataset.theme`),
      'light',
    )
    check.equal(
      'the restore leaves nothing to undo',
      (await page.evaluate(READ_HISTORY_BUTTONS)).undo?.disabled,
      true,
    )

    console.log('\nClearing the saved data')
    await page.evaluate(`window.confirm = () => true; return true`)
    const clearButton = await page.evaluate(`
      const box = document.querySelector('[data-testid="clear-storage"]').getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    `)
    await page.click(clearButton.x, clearButton.y)
    await sleep(400)
    check.equal('clearing empties the canvas', (await blocks()).length, 0)
    const afterClear = await readStored()
    check.equal('and the stored document with it', afterClear?.document, null)

    await page.reload()
    check.equal('and it stays gone across a reload', (await blocks()).length, 0)

    /*
     * The narrow breakpoint, measured for the first time.
     *
     * `@media (width <= 560px)` was written in Phase 5 and never checked: this
     * harness ran at 1280x900, where the rule does not apply, and jsdom
     * evaluates no media queries at all. Everything below is a layout fact, so
     * this is the only place in the repository that can assert any of it.
     */
    console.log('\nNarrow viewport (400x800)')
    // The panel only exists while something is selected, and the section above
    // finished by clearing the canvas entirely.
    await page.press('r')
    await page.click(canvas.left + 240, canvas.top + 220)
    await page.press('r')
    await page.click(canvas.left + 560, canvas.top + 220)
    await page.press('a', MODIFIER.ctrl)
    check.equal('two blocks to select', (await blocks()).length, 2)
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
