# FlowCraft

Browser-based diagram editor built from scratch — custom drag-and-drop, undo/redo, and connection routing on SVG. No backend required.

## Stack

- **React 19 + TypeScript** in strict mode
- **Vite** for dev server and build
- **SVG** for rendering — chosen over Canvas deliberately: it is accessible, inspectable in DevTools, and exportable
- **Zustand** for state, with a command pattern for undo/redo
- **@use-gesture/react** for pointer gestures (pan, zoom, pinch)
- **Vitest + Testing Library** for unit and component tests
- **ESLint (flat config) + Prettier** for linting and formatting

## Getting started

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

The dev server prints a local URL — open it in a browser.

## Scripts

| Script                   | Purpose                                    |
| ------------------------ | ------------------------------------------ |
| `npm run dev`            | Start the Vite dev server                  |
| `npm run build`          | Type-check and produce a production bundle |
| `npm run preview`        | Serve the production build locally         |
| `npm run typecheck`      | Type-check without emitting                |
| `npm run lint`           | Run ESLint                                 |
| `npm run format`         | Format with Prettier                       |
| `npm test`               | Run the test suite once                    |
| `npm run test:watch`     | Run tests in watch mode                    |
| `npm run test:coverage`  | Run tests with a coverage report           |
| `npm run verify:browser` | Drive the app in a real Chrome over CDP    |

## Testing

```bash
npm test
```

### Verifying in a real browser

```bash
npm run verify:browser
```

jsdom implements no layout, no hit testing and no pointer capture — the three
things a gesture regression actually shows up in. Phase 3 found a permanent
3px cursor lag that way, and this script keeps that capability in the
repository instead of in a scratch directory.

It boots the Vite dev server through Vite's Node API, launches headless Chrome,
and drives the page over the **DevTools Protocol** with real mouse and keyboard
input — no dependencies beyond Node 24's global `WebSocket`. The checks are
coordinate-exact: a dragged block must land where the pointer left it, to the
hundredth of a unit. Set `CHROME_PATH` if Chrome is somewhere unusual.

This is a harness, not a test suite — Playwright arrives in Phase 7. It lives
in [scripts/browser-harness.mjs](scripts/browser-harness.mjs) (the Chrome
driving) and [scripts/verify-browser.mjs](scripts/verify-browser.mjs) (the
checks).

## Controls

### Tools

| Action          | Input                                                  |
| --------------- | ------------------------------------------------------ |
| Select tool     | `V`                                                    |
| Rectangle tool  | `R`                                                    |
| Text tool       | `T`                                                    |
| Snap to grid    | `G`, or the **Snap** button (on by default)            |
| Create a block  | Pick Rectangle or Text, then click the canvas          |
| Edit block text | Double-click a block — `Enter` confirms, `Esc` cancels |

### Dragging

What a drag does depends on the active tool and where it starts.

| Drag                    | Select tool            | Rectangle / Text tool |
| ----------------------- | ---------------------- | --------------------- |
| On empty canvas         | **Marquee selection**  | Pan                   |
| On a block              | **Move the selection** | Pan                   |
| On a resize handle      | **Resize the block**   | Pan                   |
| On a port               | **Draw a connection**  | —                     |
| Middle button, anywhere | Pan                    | Pan                   |
| `Space` held, anywhere  | Pan                    | Pan                   |

`Esc` during a move, resize or connection drag cancels it and puts everything
back where it started.

### Connections

Hover a block with the Select tool and four **ports** appear on its edges.
Drag from a port onto another block to wire them together; release over empty
canvas to abandon the attempt.

| Action               | Input                                     |
| -------------------- | ----------------------------------------- |
| Show a block's ports | Hover it with the Select tool             |
| Draw a connection    | Drag from a port onto another block       |
| Cancel while drawing | Release over empty canvas, or press `Esc` |
| Select a connection  | Click the line                            |
| Add / remove one     | `Shift` + click, or `Ctrl`/`Cmd` + click  |
| Delete connections   | `Delete` or `Backspace`                   |

A connection stores **only the two block ids** and the anchor it left from —
never any endpoint coordinates. The polyline is re-derived from the blocks'
current rects on every render, which is why arrows follow their blocks with no
synchronising code. Routes are orthogonal, leave and arrive perpendicular to
the edge, and pick their sides from the blocks' relative positions unless an
anchor was pinned. A block wired to itself, or an exact repeat of an existing
link, is refused.

Deleting a block deletes the connections that touch it. A marquee selects
blocks only, so the gesture stays predictable.

### Resizing

Handles appear when exactly one block is selected: four corners and four edge
midpoints. The opposite corner or edge stays anchored, `Shift` keeps the aspect
ratio on a corner handle, and a block never shrinks below 20×20 world units.

### Snap to grid

Snapping is **on by default**, at the base 20-unit grid, and applies to moving,
resizing and creating blocks. The toolbar's **Snap** button toggles it, as does
`G`.

| Action                        | Behaviour                                                 |
| ----------------------------- | --------------------------------------------------------- |
| Move a block                  | The block you grabbed lands on the grid                   |
| Move several blocks           | The grabbed block snaps; the rest shift by the same delta |
| Resize                        | The edges the handle moves snap; the anchor stays put     |
| Create a block                | The new block's corner snaps                              |
| Hold `Alt` during any gesture | Inverts snapping for that gesture only                    |

Moving a multi-selection deliberately derives **one** delta from the grabbed
block rather than snapping each block on its own — snapping them individually
would quietly collapse the gaps between them. `MIN_BLOCK_SIZE` still wins over
the grid, so a block squashed to its floor stays exactly 20 units.

### Selection

| Action               | Input                                              |
| -------------------- | -------------------------------------------------- |
| Select a block       | Click it                                           |
| Add / remove a block | `Shift` + click, or `Ctrl`/`Cmd` + click           |
| Marquee              | Drag empty canvas — selects every block it touches |
| Add with a marquee   | `Shift` + drag empty canvas                        |
| Select all (blocks)  | `Ctrl`/`Cmd` + `A`                                 |
| Clear the selection  | Click empty canvas, or `Esc`                       |
| Delete the selection | `Delete` or `Backspace`                            |

### Undo and redo

Every edit is a **command** that knows how to apply and revert itself. Undo and
redo are unlimited up to the last 100 edits, after which the oldest are
dropped.

| Action | Input                                                         |
| ------ | ------------------------------------------------------------- |
| Undo   | `Ctrl`/`Cmd` + `Z`, or the **Undo** button                    |
| Redo   | `Ctrl`/`Cmd` + `Shift` + `Z`, `Ctrl`/`Cmd` + `Y`, or **Redo** |

The toolbar buttons are `disabled` when the matching stack is empty, and their
tooltip names what the press would do — _Undo: Move 3 blocks_.

**What is recorded:** creating, moving, nudging, resizing, deleting and
renaming blocks; creating and deleting connections; pasting and duplicating.

**What is not:** the viewport, the active tool, the Snap toggle, and selection
on its own. Clicking around must not fill the history with entries that change
nothing anyone would call an edit. Commands _do_ carry the selection from
either side of themselves, though, and restore it — undoing a delete gives the
elements back **and** leaves them selected, so there is something to look at.

A gesture is **one** entry, emitted when the pointer is released, however many
frames it took. A gesture cancelled with `Esc` records nothing at all, and
neither does one that ended where it began.

### Nudging

| Action                | Input                |
| --------------------- | -------------------- |
| Move one unit         | Arrow keys           |
| Move a grid step (20) | `Shift` + arrow keys |

Nudges are literal: an arrow key always moves one world unit, whatever the Snap
toggle says. A nudge that jumped a whole cell because snapping happened to be
on would not be a nudge, and one that moved a different distance each press
would be unpredictable to hold down.

Consecutive nudges within half a second **merge into one history entry**, so
holding an arrow key and then pressing `Ctrl`+`Z` walks the whole run back at
once rather than one unit at a time. The merge window restarts on each press,
so a long hold stays one entry however long it goes on.

### Copy, paste and duplicate

| Action    | Input              |
| --------- | ------------------ |
| Copy      | `Ctrl`/`Cmd` + `C` |
| Paste     | `Ctrl`/`Cmd` + `V` |
| Duplicate | `Ctrl`/`Cmd` + `D` |

The clipboard is **internal to the editor** — not the system clipboard, which
is permission-gated, asynchronous, and would mean accepting arbitrary data from
outside the app.

Copying takes the selected blocks and any connection with **both** ends among
them; an arrow with one end left behind is dropped, because pasting it would
either dangle or silently wire the copy back into the original diagram. Pasting
mints new ids and **remaps** the copied connections onto them, so the copies
wire to each other. Each paste is offset one grid step further than the last,
so pasting three times leaves three visible copies rather than a pile. Every
paste or duplicate is a single history entry.

### View

| Action     | Input                                                  |
| ---------- | ------------------------------------------------------ |
| Zoom       | Mouse wheel or pinch, anchored at the cursor (0.1×–4×) |
| Reset view | `0`, or the **Reset view** button                      |

## Architecture notes

- Block coordinates are stored in **world space**, never in screen pixels. The screen↔world conversion lives in pure, tested functions in [src/utils/coords.ts](src/utils/coords.ts).
- Pan and zoom are applied through the `<svg>` `viewBox`, not a CSS transform on the container, so world units stay the SVG user-space units.
- The Zustand store is the single source of truth. Every diagram mutation is a named store action, which is what lets the history wrap them in reversible commands.
- Every pointer gesture runs through **one handler on the `<svg>`** ([src/hooks/useCanvasGestures.ts](src/hooks/useCanvasGestures.ts)). It picks a mode — pan, move, marquee, resize or connect — once at the start of the gesture and keeps it in a ref, rather than attaching a gesture recogniser per block.
- A drag snapshots the state it is about to change and then applies `snapshot + accumulated delta` on every frame. Nothing accumulates rounding error, `Esc` can rewind to the snapshot, and the history gets a single before/after pair per drag instead of one per frame — `endSession` is the one place a gesture becomes a command.
- The tap threshold is a **deadzone only**. `@use-gesture` latches it and subtracts it from `movement` for the rest of a gesture, which leaves a dragged block trailing the cursor by 3px permanently — measured in Chrome, and it never catches up. Gestures therefore work from `xy - initial`, the pointer's true travel.
- Geometry stays out of both the store and the components: marquee, bounds and resize maths are pure functions in [src/utils/geometry.ts](src/utils/geometry.ts), connection routing in [src/utils/routing.ts](src/utils/routing.ts), and grid snapping in [src/utils/snap.ts](src/utils/snap.ts).
- **Connections store no geometry.** Only ids and optional anchors live in the store; the polyline comes from `routeConnection` at render time. This is the single decision that makes arrows track their blocks for free.
- Snapping is a transformation of a gesture's **result**, not a change to the gesture layer — which is what lets `Alt` invert it mid-drag without any gesture maths knowing about it.
- Blocks and connections have **separate selection lists**. Move, resize, marquee and the bounding box all mean "blocks"; one tagged list would have every hot path filtering by kind on each frame.
- `removeBlocks` **returns** the connections it cascaded away, as whole objects. Undo cannot recompute them after the fact — by then they are gone — so the knowledge stays with the `set` that destroyed them.
- Undo/redo is the **command pattern**, in its explicit `apply`/`revert` form rather than as before/after document snapshots — see the essay at the top of [src/history/command.ts](src/history/command.ts) for why. In short: `setBlockPositions` is absolute and idempotent, so a move's inverse is replaying the earlier snapshot through the same action; `removeBlocks` returns the connections it cascaded away, so a delete captures exactly what it destroyed; and a command that knows what it touched can label itself and merge with its neighbour, which two opaque snapshots cannot.
- Commands hold **copies, never references into the store**. The store swaps block objects out wholesale on every patch, so a captured reference either goes stale or silently rewrites the history's idea of the past.
- Commands must be **idempotent**: applying twice then reverting twice lands on the state you started from. That is not academic — a gesture updates the store live and only records afterwards, so the first `apply` a command ever sees is already a replay.
- Undo/redo are fenced off by an explicit `applying` flag rather than a "am I inside a revert?" inference. A `revert` calls the same store actions the editor does, and anything that recorded on store changes would happily record the undo itself.
- `insertBlocks`/`insertConnections` restore into the **slot the element came from**, not onto the end. `addBlock`'s explicit id was not enough on its own: undoing the delete of a block that sat underneath another would silently bring it back on top.
- Every undoable operation lives in [src/history/actions.ts](src/history/actions.ts), and components call those rather than the store. "Which edits are undoable" is answerable by reading one file.
- Constant-size affordances — resize handles, ports, connection hit areas, the arrowhead marker — are all `PIXELS / zoom`. The arrowhead uses `markerUnits="userSpaceOnUse"` with a `viewBox`, because `strokeWidth` units size the marker off the _declared_ stroke width and would fight `vector-effect="non-scaling-stroke"`.

## Status

In active development. Built in phases:

1. ✅ Project setup, SVG canvas with pan/zoom, block creation
2. ✅ Drag-and-drop, multi-select, resizing
3. ✅ Connections between blocks, snap-to-grid
4. ✅ Undo/redo (command pattern), keyboard shortcuts
5. ⬜ Element styling, grouping
6. ⬜ PNG/SVG export, IndexedDB auto-save, dark/light themes
7. ⬜ Performance, Playwright E2E, deploy

Screenshots and a demo GIF land in Phase 7.

## License

[MIT](LICENSE)
