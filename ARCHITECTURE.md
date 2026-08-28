# FlowCraft — architecture

Why the program is shaped the way it is. Each note is a decision that had at
least one plausible alternative, and says what the alternative cost.

This is the long half of the documentation; [README.md](README.md) is the short
one. Nothing here is required to use the editor.

---

## Contents

- [The shape of the program](#the-shape-of-the-program)
- [Gestures](#gestures)
- [Geometry and routing](#geometry-and-routing)
- [Undo and redo](#undo-and-redo)
- [Styling and the SVG cascade](#styling-and-the-svg-cascade)
- [Groups](#groups)
- [Themes](#themes)
- [Persistence](#persistence)
- [Export](#export)
- [Performance](#performance)
- [How the tests are split](#how-the-tests-are-split)

---

## The shape of the program

- Block coordinates are stored in **world space**, never in screen pixels. The
  screen↔world conversion lives in pure, tested functions in
  [src/utils/coords.ts](src/utils/coords.ts).
- Pan and zoom are applied through the `<svg>` `viewBox`, not a CSS transform
  on the container, so world units stay the SVG user-space units.
- The Zustand store is the single source of truth. Every diagram mutation is a
  named store action, which is what lets the history wrap them in reversible
  commands — and, in Phase 7, what made viewport culling safe to add: culling
  changes what is in the DOM and nothing else, because the DOM was never
  authoritative about anything.
- **SVG rather than Canvas**, decided in Phase 1 and never regretted. A canvas
  would have meant writing hit testing, text layout and an accessibility tree
  by hand, and the export would have been a screenshot. With SVG the browser
  does the hit testing, `getComputedStyle` can be asserted against in tests,
  DevTools shows the diagram as a tree, and the export is the same markup with
  the editing furniture left out. The cost is a DOM node per visible element,
  which is what [Performance](#performance) is about.

## Gestures

- Every pointer gesture runs through **one handler on the `<svg>`**
  ([src/hooks/useCanvasGestures.ts](src/hooks/useCanvasGestures.ts)). It picks a
  mode — pan, move, marquee, resize or connect — once at the start of the
  gesture and keeps it in a ref, rather than attaching a gesture recogniser per
  block. A diagram with a thousand blocks has one listener.
- A drag snapshots the state it is about to change and then applies
  `snapshot + accumulated delta` on every frame. Nothing accumulates rounding
  error, `Esc` can rewind to the snapshot, and the history gets a single
  before/after pair per drag instead of one per frame — `endSession` is the one
  place a gesture becomes a command.
- The tap threshold is a **deadzone only**. `@use-gesture` latches it and
  subtracts it from `movement` for the rest of a gesture, which leaves a
  dragged block trailing the cursor by 3px permanently — measured in Chrome,
  and it never catches up. Gestures therefore work from `xy - initial`, the
  pointer's true travel.
- Snapping is a transformation of a gesture's **result**, not a change to the
  gesture layer — which is what lets `Alt` invert it mid-drag without any
  gesture maths knowing about it.
- Moving a multi-selection derives **one** delta from the grabbed block rather
  than snapping each block on its own. Snapping them individually would quietly
  collapse the gaps between them. `MIN_BLOCK_SIZE` still wins over the grid, so
  a block squashed to its floor stays exactly 20 units.
- Nudges are literal: an arrow key always moves one world unit, whatever the
  Snap toggle says. A nudge that jumped a whole cell because snapping happened
  to be on would not be a nudge, and one that moved a different distance each
  press would be unpredictable to hold down.
- Blocks and connections have **separate selection lists**. Move, resize,
  marquee and the bounding box all mean "blocks"; one tagged list would have
  every hot path filtering by kind on each frame. A mixed selection — some
  blocks and some arrows, deleted together — falls out for free.
- The marquee reads `blockOrder` from the store, not the DOM. That was already
  true before culling existed, and it is why culling could not break it.

## Geometry and routing

- Geometry stays out of both the store and the components: marquee, bounds and
  resize maths are pure functions in
  [src/utils/geometry.ts](src/utils/geometry.ts), connection routing in
  [src/utils/routing.ts](src/utils/routing.ts), and grid snapping in
  [src/utils/snap.ts](src/utils/snap.ts).
- **Connections store no geometry.** Only ids and optional anchors live in the
  store; the polyline comes from `routeConnection` at render time. This is the
  single decision that makes arrows track their blocks for free — no listener,
  no cache, nothing to invalidate.
- A connection refuses two things: a block wired to itself, which has no
  sensible orthogonal route and reads as a slip of the pointer; and an exact
  repeat of an existing link, which would only ever paint a second arrow on top
  of the first. Anchors are part of the identity, so deliberately routing a
  second arrow out of a different side is still allowed.
- Anchor sides are chosen from the **centre-to-centre offset**, not the gap
  between edges. Centre-based is stable: the answer changes only when a block
  crosses the diagonal, not every time an edge grazes past another, so an arrow
  does not flap between sides during a drag.
- Constant-size affordances — resize handles, ports, connection hit areas, the
  arrowhead marker — are all `PIXELS / zoom`. The arrowhead uses
  `markerUnits="userSpaceOnUse"` with a `viewBox`, because `strokeWidth` units
  size the marker off the _declared_ stroke width and would fight
  `vector-effect="non-scaling-stroke"`.

## Undo and redo

- Undo/redo is the **command pattern**, in its explicit `apply`/`revert` form
  rather than as before/after document snapshots — see the essay at the top of
  [src/history/command.ts](src/history/command.ts) for why. In short:
  `setBlockPositions` is absolute and idempotent, so a move's inverse is
  replaying the earlier snapshot through the same action; `removeBlocks`
  returns the connections it cascaded away, so a delete captures exactly what
  it destroyed; and a command that knows what it touched can label itself and
  merge with its neighbour, which two opaque snapshots cannot.
- Commands hold **copies, never references into the store**. The store swaps
  block objects out wholesale on every patch, so a captured reference either
  goes stale or silently rewrites the history's idea of the past.
- Commands must be **idempotent**: applying twice then reverting twice lands on
  the state you started from. That is not academic — a gesture updates the
  store live and only records afterwards, so the first `apply` a command ever
  sees is already a replay.
- Undo/redo are fenced off by an explicit `applying` flag rather than a "am I
  inside a revert?" inference. A `revert` calls the same store actions the
  editor does, and anything that recorded on store changes would happily record
  the undo itself.
- `removeBlocks` **returns** the connections it cascaded away, as whole
  objects. Undo cannot recompute them after the fact — by then they are gone —
  so the knowledge stays with the `set` that destroyed them.
- `insertBlocks`/`insertConnections` restore into the **slot the element came
  from**, not onto the end. `addBlock`'s explicit id was not enough on its own:
  undoing the delete of a block that sat underneath another would silently
  bring it back on top.
- Every undoable operation lives in
  [src/history/actions.ts](src/history/actions.ts), and components call those
  rather than the store. "Which edits are undoable" is answerable by reading
  one file.
- Commands carry the selection from **either side** of themselves and restore
  it. Undoing a delete gives the elements back _and_ leaves them selected, so
  there is something to look at.
- **The merge policy is generic.** Phase 4 grew it inside `createMoveCommand`;
  Phase 5's colour picker needed the same thing, so it lives in
  [src/history/merge.ts](src/history/merge.ts) now. The split is deliberate:
  the module owns _whether_ two commands may fold together (same kind, same
  key, inside the window), and the command owns _what the folded command is_ —
  a helper cannot know that a move keeps the first `before` and the last
  `after`.
- The history holds the last 100 edits. Not recorded: the viewport, the active
  tool, the Snap toggle, the theme, and selection on its own. Clicking around
  must not fill the history with entries that change nothing anyone would call
  an edit.

## Styling and the SVG cascade

- Style overrides are applied as **inline style, never as presentation
  attributes**. In SVG a presentation attribute sits at the _bottom_ of the
  cascade, below every author rule, so `fill="#e2683c"` loses to
  `.block__shape { fill: … }` — the attribute is set, the DOM assertions pass,
  and the block still renders in the default colour. The browser harness caught
  exactly that; `getComputedStyle` in a real renderer was the only thing that
  disagreed. Inline style wins while staying per-property, so an unset field
  still falls through to the class.
- Every style field is **optional, and an unset one emits nothing**.
  `resolveBlockStyle` fills defaults for the _panel_ to display; nothing writes
  them into the document. Resolving at render time would bake today's palette
  into every block the moment anyone opened the panel.
- **One arrowhead marker per colour in use**, not per connection. A `<marker>`
  cannot inherit the colour of the path that references it —
  `context-stroke` is not portable — so the colour has to be baked in. Marker
  ids are derived from the colour string, which means a hundred red arrows
  share one marker and `<defs>` grows with the size of the palette rather than
  the size of the diagram. Selection is deliberately _not_ part of the key: a
  selected arrow gets a halo drawn underneath instead of being recoloured, so a
  user's colour survives selection and the head can never drift a different
  shade from its own line.
- **Blocks and arrows get separate panel sections**, even when both are
  selected. The tempting intersection — both have a "stroke" and a "stroke
  width" — is a false friend: a block's stroke is the outline around a filled
  shape, an arrow's is the entire element, and one control driving both would
  make an arrow vanish while merely thinning a block's border.
- Where a selection disagrees about a value the panel says **Mixed** rather
  than showing the first element's value and quietly speaking for the rest.
  Setting from there applies to everything selected; undo gives every element
  back _its own_ former value, not one shared value.

## Groups

- **Groups have no selection state of their own.** Selecting a group _is_
  selecting its member blocks — every gesture widens a hit through
  `expandToGroups` — so "the group is selected" and "all its members are
  selected" are the same fact, derived by `selectedGroups`. Storing it as well
  would give move, delete, marquee and the bounding box a second source of
  truth to disagree with, and it means group move, group delete and the group
  cascade all fall out of the Phase 2–4 machinery with no new code paths.
- **Groups do not nest.** `Group` has no `groupIds` field, so a group inside a
  group is not merely unsupported — it is unrepresentable. Grouping a selection
  that already spans a group therefore _absorbs_ it: the members come across
  and the old group dissolves. Flattening avoids recursive traversal, cycle
  detection and the partial-ungroup question, none of which has an obvious
  right answer; and since clicking one member already selects the whole group,
  the situation arises constantly rather than rarely, so refusing it outright
  would fail an ordinary action for a reason the user cannot see.
- Membership is the group's, not the block's. A `Block.groupId` would be the
  same fact stored twice, and the two copies would disagree the first time a
  delete pruned one and not the other.
- `removeBlocks` **returns the groups it disturbed** alongside the connections
  it cascaded — shrunk ones as well as dissolved ones, in the state they were
  in beforehand. Same reasoning as the arrows: by the time undo runs, the
  membership it would have to reconstruct is gone.
- `insertGroups` is the one restore primitive that is **absolute rather than
  insert-if-missing**. Deleting one member of a three-block group leaves the
  group alive with two, so undo has a group to put a member _back into_, not a
  group to re-create — an insert-if-missing primitive would silently do nothing
  in exactly that case.
- **Double-click, not `Alt` + click,** steps into a group. `Alt` already
  inverts snapping for the duration of a gesture, so an `Alt`-click that turned
  into a small drag would be entering a group and disabling the grid at once —
  two unrelated meanings on one modifier, told apart only by how far the
  pointer happened to travel.
- Clicking a member you have already stepped into keeps you inside it.
  Re-widening there would undo the step-in the instant the user tried to drag
  what they had just singled out.
- `ElementPlacements` took a **third element kind** without changing shape.
  `spliceInOrder` and `capturePlacements` were already written against "an id,
  an index and an order list" rather than against blocks specifically, so
  groups cost one more field and one more loop. Removal stays silent about
  groups on purpose: `removeBlocks` already prunes and dissolves, and a
  placement set always holds either all of a group's members or some of them,
  so an explicit `removeGroups` there would wipe a group that only lost one
  member.

## Themes

- **One palette table, and the stylesheet is generated from it.** Phase 5 left
  `index.css` declaring `--block-fill: #232833` and `utils/style.ts` declaring
  the same hex in `DEFAULT_BLOCK_STYLE` — two hand-kept copies of one fact,
  which a second theme breaks outright: the panel would show one theme's
  colours while the canvas painted the other's, and the mixed-value detection
  compares _resolved_ values, so it would answer differently depending on which
  stylesheet was loaded. [src/theme/tokens.ts](src/theme/tokens.ts) is now the
  only place a colour is written down, and
  [src/theme/stylesheet.ts](src/theme/stylesheet.ts) emits the custom
  properties from it. The other direction — CSS authoritative, values read back
  through `getComputedStyle` — was rejected because `strokeWidth` and
  `fontSize` are numbers rather than colours (a unit typo becomes `NaN` at
  render time instead of a type error at build time), and because jsdom has no
  cascade to read them out of, so every unit test would have needed a stub that
  is a second table wearing a different hat.
- Switching theme is **one attribute on `<html>`**. No component re-renders to
  change colour, no element is rewritten, and nothing in the document is
  touched — which is exactly why a theme switch cannot trigger the auto-save.
- Style defaults are a **function of the theme**, threaded in as an argument
  rather than looked up. "What does unstyled look like" now has two answers,
  and the panel's mixed-value detection genuinely depends on which: a block
  explicitly painted the dark default sits beside an unstyled one, and the two
  agree in dark and differ in light.
- **A theme repaints what you have not painted yourself.** A block you gave a
  colour keeps it in both themes — it is what you chose. A block you never
  touched follows the theme, because its colour was never part of the document:
  it emits no `fill` at all and takes whatever the stylesheet says.
- The theme is resolved from `prefers-color-scheme` **before the first render**
  and corrected by the stored preference a beat later. Reading storage first is
  asynchronous, and any other order has a wrong frame in it — in SVG that means
  black shapes on a transparent canvas, not merely the wrong palette.

## Persistence

- The persisted document **mirrors the store's own slice**, maps and order
  lists and all, rather than flattening to arrays in paint order. Arrays are
  the tidier file and cannot contradict themselves, and that was the argument
  against them: they would have to be _reconstructed_ into maps and orders on
  every load, which is a transformation applied to the user's document every
  time the app opens. Mirroring makes `toDocument`/`fromDocument` a rename, so
  the round trip is the identity by construction. The redundancy is real — and
  it is why the validator checks it.
- **Persisted data is external data.** A load is the one door into the store
  that does not come from a command, so it is the one door that checks. The
  policy is two-sided: a value of the wrong _shape_ (not an object, no version,
  `blocks` as an array, a version from the future) is refused whole and the
  editor opens empty, because there is nothing to salvage that would not be
  invented; a document of the right shape whose _references_ do not hold up is
  **repaired** — orphaned arrows dropped, dead group members pruned, groups
  below two dissolved, a block claimed by two groups left with the first, order
  lists rebuilt. That is not leniency: it is precisely what `removeBlocks` and
  `pruneGroups` would have done in a running editor, so the repair reproduces
  the editor's own cascade rather than inventing a second, laxer notion of
  soundness. Every repair is reported rather than performed silently.
- A **version field from the very first save**, with the migration chain in
  place while it is still empty. The day a version 2 exists, every document on
  disk is a version 1 and a path invented at that point has to be right first
  time against data nobody can reproduce; a path that has been there and tested
  from the beginning only has to be populated. The walk owns the version
  counter, so a migration that forgets to bump it cannot loop. A document from
  the _future_ is refused rather than read with older rules — doing otherwise
  drops fields this build has never heard of and then saves the loss back over
  the original.
- **Preferences are a separate record with the opposite policy**: read field by
  field, never refused. Every field there has an obvious default, so rejecting
  the record would cost a user their theme over a bad boolean. A document has
  no such default, which is why that one is refused whole.
- The auto-save watches the **six document slices by reference** and nothing
  else. That is structural rather than a list of exceptions: selecting,
  panning, zooming, switching tool and switching theme cannot trigger a
  document write, because none of them replaces any of those references.
  Preferences ride their own debounce, so a pan writes a preferences record and
  never a document.
- `changed()` **carries no payload**; the snapshot is taken when the write
  happens. A drag reports a change on every pointer frame, and handing a
  document to the debouncer per frame would deep-copy the whole diagram sixty
  times a second to throw away fifty-nine of the copies.
- The debounce has a **ceiling as well as a quiet period**. A long editing
  session is a continuous stream of changes, and a debounce that only ever
  restarts its timer would keep postponing the write for as long as the user
  kept working.
- Writes are **chained rather than fired in parallel**. Two overlapping puts to
  one key can land in either order, and the loser is an older document
  overwriting a newer one — a data-loss bug that would show up only under a
  slow disk, which is to say only on someone else's machine.
- **Storage is injectable, and IndexedDB is verified in a real browser.** jsdom
  has none, and `fake-indexeddb` is a polyfill several times the size of
  everything in [src/persistence/](src/persistence/) — installed so unit tests
  could exercise an API the browser already exercises for real. Three keys of
  async get/put/delete is the whole surface, so the seam goes there:
  serialising, validating, migrating and debouncing are tested against an
  in-memory driver, and the real driver is checked in Chrome by
  [e2e/persistence.spec.ts](e2e/persistence.spec.ts).
- **Storage failing is not an error the user has to clear.** The editor is a
  complete program without it, so a private window degrades to an in-memory
  session, a quiet "Not saved" in the corner and nothing else. Every write
  rejection is caught and swallowed; none of them reaches a caller.
- The undo history is **deliberately not persisted**. Its commands captured
  `revert` against a document that is gone the moment the tab closes, so a redo
  replayed after a reload is exactly the branch the history layer already
  refuses in memory — and offering to undo an edit made in a session the user
  cannot remember is a strange thing to offer.

## Export

- The export is **built from the document, not scraped from the DOM**. Cloning
  the live `<svg>` and stripping the chrome out of it is the obvious
  implementation and fails three ways: it exports only what is on screen (which
  Phase 7's culling would turn into a silently partial diagram, and nothing
  about that failure looks like one); "remove the grid, the marquee, the ports,
  the handles…" is a list to be kept in step with every future affordance; and
  it needs a rendered app, where a pure function of the document can be tested
  exhaustively. Nothing is duplicated: the routing, the style resolution and
  the marker-id scheme are the same functions the canvas draws with.
- Exported styles travel as an **embedded `<style>` rather than inlined onto
  every element**. A loose `.svg` has no access to the app's stylesheet, so the
  class-based defaults have to become concrete somewhere — but inlining them
  would flatten "unstyled" into "explicitly this colour", which is a different
  document and no longer re-themable by hand. Per-element overrides keep
  working exactly as they do in the app, because they are inline styles and
  inline beats a class. `vector-effect: non-scaling-stroke` is the one thing
  deliberately not carried over: on the canvas it keeps a border one screen
  pixel wide at any zoom, which is an editing affordance; in a file it would
  make borders thin out as the image is scaled up.
- The export frames on **content plus a margin**, and `contentBounds` walks the
  routed connection points as well as the blocks. An orthogonal route can swing
  clear of both boxes it joins, and framing on the blocks alone would clip
  exactly those arrows. The viewport is never consulted: where one person's
  camera was sitting is not part of the diagram, and two people exporting the
  same document must get the same file.
- An **empty diagram exports nothing at all** — `exportSvg` returns `null` and
  the toolbar disables the button. A blank file and a zero-sized one are both
  worse in the same way: they look like a successful export and open as a blank
  page, which is indistinguishable from a bug that ate the diagram.
- The PNG is the **exported SVG rasterised**, not a second renderer, so the two
  cannot drift. There is no `foreignObject` anywhere in the document — the
  text-input overlay is HTML but is not part of the diagram — which removes the
  usual silent-failure mode; and a failure to rasterise rejects with a message
  rather than saving a blank image, because a PNG that is quietly the wrong
  picture is found out after it has been sent to someone.
- The background is **opaque by default**. A transparent PNG of a dark-theme
  diagram is pale strokes on nothing, and dropped into a white document it is
  invisible; the option is there for compositing.

## Performance

Phase 7's rule was to measure first. The numbers below come from
`npm run measure:perf`, which drives the **production bundle** in a real Chrome
— React's development build renders everything twice under StrictMode, so
timing it would describe a program nobody runs.

### What the measurements found

At 500 blocks and 800 connections — already a very large hand-drawn diagram —
the editor was **already fast**: a locked 60fps drag, a 106ms cold load, a
14ms first render. The curve bent between 2,000 and 5,000 blocks, where drag
frames fell to 33ms, i.e. 30fps.

Two things fixed all of it.

- **`BlockView`'s `memo` had been doing nothing for four phases.** Its
  `onActivate` prop was a fresh closure on every canvas render, so every block
  re-rendered whenever any block moved. Wrapping the handler in `useCallback`
  with an empty dependency list — correct because everything it reads comes
  through `getState()` at call time rather than being closed over — took drag
  frames at 5,000 blocks from 33.3ms to 16.7ms. Nothing had failed; the only
  symptom was frame budget.
  [src/components/Memoisation.test.tsx](src/components/Memoisation.test.tsx)
  now counts component invocations, because a comment asking for a stable prop
  would not have caught it.
- **Viewport culling** ([src/utils/culling.ts](src/utils/culling.ts)). A
  1280×900 window at zoom 1 shows about thirty blocks; the canvas was putting
  all 5,000 in the DOM — 39,009 SVG elements against 618 once culled.

### What culling is allowed to mean

Only "not in the DOM this frame". Nothing in `utils/culling.ts` touches the
store, so a culled element is still in the document, still exported, still
saved, still reached by Select All, and still swept up by a marquee — the
marquee reads `blockOrder`, not the DOM. That distinction is the whole safety
argument, and it is the Phase 2 single-source-of-truth rule paying off five
phases later.

Two rules keep it from hiding anything that matters:

1. **A 400px screen-space margin.** Screen rather than world, so the band is
   the same size at every zoom instead of shrinking to nothing when the most is
   on screen.
2. **The selection is never culled.** Whatever the user has hold of stays
   rendered wherever it goes. Without this, dragging a block off the edge of
   the window would make it vanish mid-gesture, and nudging a selection out of
   view would lose its outline.

Connections are culled against a **conservative** bound rather than their
actual route: every point `routeConnection` produces lies within the union of
the two block rects grown by the anchor stub, so the union is never smaller
than the path. Over-approximating renders the occasional arrow nobody can see;
under-approximating erases one somebody is looking at. The property is asserted
against the router itself, over every relative arrangement of two blocks, in
[src/utils/culling.test.ts](src/utils/culling.test.ts).

### What was measured and left alone

- **`toDocument` deep-clones the whole document on every auto-save**, noted as
  a debt in Phase 6. Measured: 0.8ms at 500 blocks, 4.6ms at 2,000, 21ms at
  5,000 — against a 600ms debounce. At the largest size tested it is 3.5% of
  the budget it has to fit in. It is the one number that still scales with
  document size, and it does not need to stop.
- **Connection routing runs per arrow per render.** With the memo working, an
  arrow only re-renders when one of its endpoint blocks actually changes
  identity, so the routing cost is proportional to what moved rather than to
  what exists. Caching it would add an invalidation problem to buy nothing the
  numbers show.
- **Zustand selectors.** `Canvas` subscribes to the whole `blocks` map, so it
  re-renders whenever anything changes. That is correct rather than wasteful:
  it is the component that decides what is visible, and with the child memos
  working its own render is a few `useMemo` passes over arrays it already
  holds.

### The one cost culling adds

**Select All on a very large diagram renders the whole diagram**, because the
selection is exempt. That is the honest consequence of rule 2 and it is bounded
by what the user deliberately selected. It is asserted, not tolerated silently,
in [e2e/culling.spec.ts](e2e/culling.spec.ts).

## How the tests are split

Three layers, and each exists because the layer below it structurally cannot
answer a particular kind of question.

**Unit and component tests** (Vitest + jsdom, 919 across 38 files). Everything
pure, plus components rendered against a mocked layout. Fast enough to run on
every save. What they cannot do: jsdom implements no layout, no hit testing, no
pointer capture, no cascade, no `canvas` and no IndexedDB, so anything that
depends on those is being asserted about empty strings and zero-sized boxes.

**End-to-end specs** (Playwright + Chromium, 67 across 9 files). Real layout,
real pointer events, real cascade, real IndexedDB, real downloads. This is
where the drag-tracking assertions live — exact to a hundredth of a world unit,
because the bug that made the layer necessary was a block trailing the cursor
by exactly the 3px tap threshold, which every approximate assertion in the
repository was happy to accept. Three findings across Phases 3–6 were invisible
in jsdom and caught here: the cursor lag, the presentation-attribute cascade
bug, and two probes that were themselves silently broken.

**The CDP rig** ([scripts/browser-harness.mjs](scripts/browser-harness.mjs)).
Not a test framework. It exists for the two jobs a test runner is the wrong
shape for: driving a _production build_ with a stopwatch
([measure-perf.mjs](scripts/measure-perf.mjs)) and recording the README's GIF
([capture-demo.mjs](scripts/capture-demo.mjs)). Both want one long-lived page
with no retries, no isolation and control over exactly which frame a number is
taken on.

Phase 7 deleted `scripts/verify-browser.mjs`, whose 148 checks all became
Playwright specs. Two harnesses covering one behaviour means two places to
update and one of them rotting quietly — and the specs are better at that job,
because they retry, isolate, trace, and can catch a download, which the rig
never could.

**The suite is Chromium-only, and that is a decision.** Firefox was tried; 38
of the 67 specs failed on `browserContext.newPage` timeouts and
`RenderCompositorSWGL` compositor crashes rather than on anything FlowCraft
did, and the 29 that ran behaved identically. A suite that fails for reasons
that are not the code's teaches everyone to re-run instead of read. Nothing in
the specs uses a Chromium-only API, so adding a project back is a four-line
change once there is somewhere stable to run it.
