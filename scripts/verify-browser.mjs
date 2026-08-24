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
