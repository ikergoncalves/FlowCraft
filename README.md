# FlowCraft

Browser-based diagram editor built from scratch — custom drag-and-drop, undo/redo, and connection routing on SVG. No backend required.

## Stack

- **React 19 + TypeScript** in strict mode
- **Vite** for dev server and build
- **SVG** for rendering — chosen over Canvas deliberately: it is accessible, inspectable in DevTools, and exportable
- **Zustand** for state, with a command pattern for undo/redo
- **@use-gesture/react** for pointer gestures (pan, zoom, pinch)
- **Vitest + Testing Library** for unit and component tests
- **IndexedDB** for auto-save, behind an injectable driver so the logic is testable without one
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
| Switch theme    | `L`, or the theme button                               |
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
renaming blocks; creating and deleting connections; pasting and duplicating;
styling blocks and connections; grouping and ungrouping.

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

Copying takes the selected blocks, any connection with **both** ends among
them, and any group **all** of whose members are along; an arrow with one end
left behind is dropped, because pasting it would either dangle or silently wire
the copy back into the original diagram, and a partly-selected group is left
behind for the identical reason. Pasting mints new ids and **remaps** both the
copied connections and the copied group memberships onto them, so the copies
wire to and group with each other. Each paste is offset one grid step further
than the last, so pasting three times leaves three visible copies rather than a
pile. Every paste or duplicate is a single history entry.

### Styling

Selecting anything opens the **properties panel** in the top-right corner of
the canvas. It edits the whole selection at once.

| Element     | Properties                                                |
| ----------- | --------------------------------------------------------- |
| Blocks      | Fill, border colour, text colour, border width, text size |
| Connections | Line colour, line width, dashed                           |

Each colour field offers a small preset palette plus a native
`<input type="color">` for anything else.

**Mixed selections.** Where the selected elements disagree about a value, the
panel says so rather than showing the first one's value and quietly speaking
for the rest: colour fields grow a **Mixed** badge and highlight no swatch,
number fields go blank with a `Mixed` placeholder, and the Dashed checkbox uses
the platform's own indeterminate state. Setting a value from there applies it
to everything selected; undo gives every element back **its own** former value,
not one shared value.

A block or arrow with **no style set renders entirely from the stylesheet** —
every style field is optional and an unset one emits nothing at all. That is
what lets Phase 6 swap a theme by editing custom properties rather than
rewriting every element in the document.

**Blocks and arrows get separate sections**, even when both are selected. The
tempting intersection — both have a "stroke" and a "stroke width" — is a false
friend: a block's stroke is the outline around a filled shape, an arrow's is
the entire element, and one control driving both would make an arrow vanish
while merely thinning a block's border.

Dragging the colour picker fires a change event on every pointer move; those
**merge into a single history entry**, the same way a held arrow key does.
Editing a different property starts a new entry.

### Grouping

| Action               | Input                                      |
| -------------------- | ------------------------------------------ |
| Group the selection  | `Ctrl`/`Cmd` + `G`                         |
| Ungroup              | `Ctrl`/`Cmd` + `Shift` + `G`               |
| Select a whole group | Click any member                           |
| Step into a group    | **Double-click** a member                  |
| Edit a member's text | Double-click again, once inside            |
| Move a group         | Drag any member — all move rigidly         |
| Delete a group       | `Delete` — members and their arrows go too |

A group needs at least two blocks, and a block belongs to at most one group. A
group that drops below two members **dissolves**; deleting a member prunes it
out of the group, and undo restores the membership exactly as it stood.

A selected group is drawn with a **fine dotted outline set slightly outside its
members**, distinct from the thin solid envelope a plain multi-selection gets.

**Groups do not nest.** `Group` has no `groupIds` field, so a group inside a
group is not merely unsupported — it is unrepresentable. Grouping a selection
that already spans a group therefore _absorbs_ it: the members come across and
the old group dissolves. Flattening rather than nesting avoids recursive
traversal, cycle detection and the partial-ungroup question, none of which has
an obvious right answer; and since clicking one member already selects the
whole group, the situation arises constantly rather than rarely, so refusing it
outright would fail an ordinary action for a reason the user cannot see.

**Double-click, not `Alt` + click,** steps into a group. `Alt` already inverts
snapping for the duration of a gesture, so an `Alt`-click that turned into a
small drag would be entering a group and disabling the grid at once — two
unrelated meanings on one modifier, told apart only by how far the pointer
happened to travel.

Resizing a group is out of scope: handles still appear only for a single block.

### Themes

| Action       | Input                                   |
| ------------ | --------------------------------------- |
| Switch theme | `L`, or the theme button in the toolbar |

Two themes, dark and light. The first visit follows the system's
`prefers-color-scheme`; after that the choice is remembered.

**A theme repaints what you have not painted yourself.** A block you gave a
colour keeps that colour in both themes — it is what you chose, and a theme has
no business overriding it. A block you never touched follows the theme, because
its colour was never part of the document in the first place: it emits no
`fill` at all and takes whatever the stylesheet says.

The properties panel shows the active theme's defaults, so the swatch under an
unstyled block is the colour it is actually painted right now.

### Export

The **Export** button offers SVG and PNG at 1× or 2×, with an optional
transparent background. It is disabled while the canvas is empty.

- **SVG** is a standalone file with an embedded stylesheet — it opens correctly
  with no access to the app.
- **PNG** is that same SVG rasterised through a `<canvas>`, so the two can
  never drift.
- The frame fits the **content** plus a margin, never the current viewport:
  where your camera happened to be is not part of the diagram, and two people
  exporting the same diagram get the same file.
- Editing furniture — grid, selection outlines, resize handles, ports, group
  boxes, the marquee, the drag preview — is absent, because the export is built
  from the document rather than scraped from the screen.
- The background is **opaque by default**. A transparent PNG of a dark-theme
  diagram is pale strokes on nothing, and dropped into a white document it is
  invisible; the option is there when you want it for compositing.
- Exporting is not an edit. It creates no undo entry and changes nothing.

### Saving

The diagram saves itself to **IndexedDB** about half a second after you stop
editing, and comes back when you reload. The toolbar's right-hand corner says
what state that is in; **Clear** forgets the saved data and empties the canvas,
after asking.

What is saved:

| Saved                                | Not saved                  |
| ------------------------------------ | -------------------------- |
| Blocks, connections, groups          | Undo history               |
| Theme, snap setting, camera position | Clipboard, selection, tool |

The document and the UI preferences live under separate keys. A diagram is
content — it is what an export produces and what would be handed to someone
else; a viewport is where one person's camera was on one machine. Keeping them
apart means a camera stuck at 4× in an empty corner can be cleared without
touching a single block.

Storage can fail — a private window, a full disk, a denied permission. When it
does the editor keeps working exactly as before and the corner reads **Not
saved** with the reason on hover. Nothing blocks, nothing retries, and no work
is lost that was not already only in memory.

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
- Style overrides are applied as **inline style, never as presentation attributes**. In SVG a presentation attribute sits at the _bottom_ of the cascade, below every author rule, so `fill="#e2683c"` loses to `.block__shape { fill: … }` — the attribute is set, the DOM assertions pass, and the block still renders in the default colour. The browser harness caught exactly that; `getComputedStyle` in a real renderer was the only thing that disagreed. Inline style wins while staying per-property, so an unset field still falls through to the class.
- Every style field is **optional, and an unset one emits nothing**. `resolveBlockStyle` fills defaults for the _panel_ to display; nothing writes them into the document. Resolving at render time would bake today's palette into every block the moment anyone opened the panel.
- **One arrowhead marker per colour in use**, not per connection. A `<marker>` cannot inherit the colour of the path that references it — `context-stroke` is not portable — so the colour has to be baked in. Marker ids are derived from the colour string, which means a hundred red arrows share one marker and `<defs>` grows with the size of the palette rather than the size of the diagram. Selection is deliberately _not_ part of the key: a selected arrow gets a halo drawn underneath instead of being recoloured, so a user's colour survives selection and the head can never drift a different shade from its own line.
- **Groups have no selection state of their own.** Selecting a group _is_ selecting its member blocks — every gesture widens a hit through `expandToGroups` — so "the group is selected" and "all its members are selected" are the same fact, derived by `selectedGroups`. Storing it as well would give move, delete, marquee and the bounding box a second source of truth to disagree with, and it means group move, group delete and the group cascade all fall out of the Phase 2–4 machinery with no new code paths.
- `removeBlocks` **returns the groups it disturbed** alongside the connections it cascaded — shrunk ones as well as dissolved ones, in the state they were in beforehand. Same reasoning as the arrows: by the time undo runs, the membership it would have to reconstruct is gone.
- `insertGroups` is the one restore primitive that is **absolute rather than insert-if-missing**. Deleting one member of a three-block group leaves the group alive with two, so undo has a group to put a member _back into_, not a group to re-create — an insert-if-missing primitive would silently do nothing in exactly that case.
- **The merge policy is generic.** Phase 4 grew it inside `createMoveCommand`; Phase 5's colour picker needed the same thing, so it lives in [src/history/merge.ts](src/history/merge.ts) now. The split is deliberate: the module owns _whether_ two commands may fold together (same kind, same key, inside the window), and the command owns _what the folded command is_ — a helper cannot know that a move keeps the first `before` and the last `after`.
- `ElementPlacements` took a **third element kind** without changing shape. `spliceInOrder` and `capturePlacements` were already written against "an id, an index and an order list" rather than against blocks specifically, so groups cost one more field and one more loop. Removal stays silent about groups on purpose: `removeBlocks` already prunes and dissolves, and a placement set always holds either all of a group's members or some of them, so an explicit `removeGroups` there would wipe a group that only lost one member.

- **One palette table, and the stylesheet is generated from it.** Phase 5 left `index.css` declaring `--block-fill: #232833` and `utils/style.ts` declaring the same hex in `DEFAULT_BLOCK_STYLE` — two hand-kept copies of one fact, which a second theme breaks outright: the panel would show one theme's colours while the canvas painted the other's, and the mixed-value detection compares _resolved_ values, so it would answer differently depending on which stylesheet was loaded. [src/theme/tokens.ts](src/theme/tokens.ts) is now the only place a colour is written down, and [src/theme/stylesheet.ts](src/theme/stylesheet.ts) emits the custom properties from it. The other direction — CSS authoritative, values read back through `getComputedStyle` — was rejected because `strokeWidth` and `fontSize` are numbers rather than colours (a unit typo becomes `NaN` at render time instead of a type error at build time), and because jsdom has no cascade to read them out of, so every unit test would have needed a stub that is a second table wearing a different hat.
- Switching theme is **one attribute on `<html>`**. No component re-renders to change colour, no element is rewritten, and nothing in the document is touched — which is exactly why a theme switch cannot trigger the auto-save.
- Style defaults are a **function of the theme**, threaded in as an argument rather than looked up. "What does unstyled look like" now has two answers, and the panel's mixed-value detection genuinely depends on which: a block explicitly painted the dark default sits beside an unstyled one, and the two agree in dark and differ in light.
- The persisted document **mirrors the store's own slice**, maps and order lists and all, rather than flattening to arrays in paint order. Arrays are the tidier file and cannot contradict themselves, and that was the argument against them: they would have to be _reconstructed_ into maps and orders on every load, which is a transformation applied to the user's document every time the app opens. Mirroring makes `toDocument`/`fromDocument` a rename, so the round trip is the identity by construction. The redundancy is real — and it is why the validator checks it.
- **Persisted data is external data.** A load is the one door into the store that does not come from a command, so it is the one door that checks. The policy is two-sided: a value of the wrong _shape_ (not an object, no version, `blocks` as an array, a version from the future) is refused whole and the editor opens empty, because there is nothing to salvage that would not be invented; a document of the right shape whose _references_ do not hold up is **repaired** — orphaned arrows dropped, dead group members pruned, groups below two dissolved, a block claimed by two groups left with the first, order lists rebuilt. That is not leniency: it is precisely what `removeBlocks` and `pruneGroups` would have done in a running editor, so the repair reproduces the editor's own cascade rather than inventing a second, laxer notion of soundness. Every repair is reported rather than performed silently.
- A **version field from the very first save**, with the migration chain in place while it is still empty. The day a version 2 exists, every document on disk is a version 1 and a path invented at that point has to be right first time against data nobody can reproduce; a path that has been there and tested from the beginning only has to be populated. The walk owns the version counter, so a migration that forgets to bump it cannot loop. A document from the _future_ is refused rather than read with older rules — doing otherwise drops fields this build has never heard of and then saves the loss back over the original.
- **Preferences are a separate record with the opposite policy**: read field by field, never refused. Every field there has an obvious default, so rejecting the record would cost a user their theme over a bad boolean. A document has no such default, which is why that one is refused whole.
- The auto-save watches the **six document slices by reference** and nothing else. That is structural rather than a list of exceptions: selecting, panning, zooming, switching tool and switching theme cannot trigger a document write, because none of them replaces any of those references. Preferences ride their own debounce, so a pan writes a preferences record and never a document.
- `changed()` **carries no payload**; the snapshot is taken when the write happens. A drag reports a change on every pointer frame, and handing a document to the debouncer per frame would deep-copy the whole diagram sixty times a second to throw away fifty-nine of the copies.
- The debounce has a **ceiling as well as a quiet period**. A long editing session is a continuous stream of changes, and a debounce that only ever restarts its timer would keep postponing the write for as long as the user kept working.
- **Storage is injectable, and IndexedDB is verified in Chrome.** jsdom has none, and `fake-indexeddb` is a polyfill several times the size of everything in [src/persistence/](src/persistence/) — installed so unit tests could exercise an API the browser harness already exercises for real. Three keys of async get/put/delete is the whole surface, so the seam goes there: serialising, validating, migrating and debouncing are tested against an in-memory driver, and the real driver is checked in a real browser.
- **Storage failing is not an error the user has to clear.** The editor is a complete program without it, so a private window degrades to an in-memory session, a quiet "Not saved" in the corner and nothing else. Every write rejection is caught and swallowed; none of them reaches a caller.
- The undo history is **deliberately not persisted**. Its commands captured `revert` against a document that is gone the moment the tab closes, so a redo replayed after a reload is exactly the branch the history layer already refuses in memory — and offering to undo an edit made in a session the user cannot remember is a strange thing to offer.
- The export is **built from the document, not scraped from the DOM**. Cloning the live `<svg>` and stripping the chrome out of it is the obvious implementation and fails three ways: it exports only what is on screen (Phase 7's virtualisation would silently produce a partial diagram, and nothing about that failure looks like one); "remove the grid, the marquee, the ports, the handles…" is a list to be kept in step with every future affordance; and it needs a rendered app, where a pure function of the document can be tested exhaustively. Nothing is duplicated: the routing, the style resolution and the marker-id scheme are the same functions the canvas draws with.
- Exported styles travel as an **embedded `<style>` rather than inlined onto every element**. A loose `.svg` has no access to the app's stylesheet, so the class-based defaults have to become concrete somewhere — but inlining them would flatten "unstyled" into "explicitly this colour", which is a different document and no longer re-themable by hand. Per-element overrides keep working exactly as they do in the app, because they are inline styles and inline beats a class. `vector-effect: non-scaling-stroke` is the one thing deliberately not carried over: on the canvas it keeps a border one screen pixel wide at any zoom, which is an editing affordance; in a file it would make borders thin out as the image is scaled up.
- The export frames on **content plus a margin**, and `contentBounds` walks the routed connection points as well as the blocks. An orthogonal route can swing clear of both boxes it joins, and framing on the blocks alone would clip exactly those arrows.
- An **empty diagram exports nothing at all** — `exportSvg` returns `null` and the toolbar disables the button. A blank file and a zero-sized one are both worse in the same way: they look like a successful export and open as a blank page, which is indistinguishable from a bug that ate the diagram.
- The PNG is the **exported SVG rasterised**, not a second renderer, so the two cannot drift. There is no `foreignObject` anywhere in the document — the text-input overlay is HTML but is not part of the diagram — which removes the usual silent-failure mode; and a failure to rasterise rejects with a message rather than saving a blank image, because a PNG that is quietly the wrong picture is found out after it has been sent to someone.

## Status

In active development. Built in phases:

1. ✅ Project setup, SVG canvas with pan/zoom, block creation
2. ✅ Drag-and-drop, multi-select, resizing
3. ✅ Connections between blocks, snap-to-grid
4. ✅ Undo/redo (command pattern), keyboard shortcuts
5. ✅ Element styling, grouping
6. ✅ PNG/SVG export, IndexedDB auto-save, dark/light themes
7. ⬜ Performance, Playwright E2E, deploy

Screenshots and a demo GIF land in Phase 7.

## License

[MIT](LICENSE)
