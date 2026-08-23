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

| Script                  | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Start the Vite dev server                  |
| `npm run build`         | Type-check and produce a production bundle |
| `npm run preview`       | Serve the production build locally         |
| `npm run typecheck`     | Type-check without emitting                |
| `npm run lint`          | Run ESLint                                 |
| `npm run format`        | Format with Prettier                       |
| `npm test`              | Run the test suite once                    |
| `npm run test:watch`    | Run tests in watch mode                    |
| `npm run test:coverage` | Run tests with a coverage report           |

## Testing

```bash
npm test
```

## Controls

| Action           | Input                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| Select tool      | `V`                                                                         |
| Rectangle tool   | `R`                                                                         |
| Text tool        | `T`                                                                         |
| Create a block   | Pick Rectangle or Text, then click the canvas                               |
| Edit block text  | Double-click a block — `Enter` confirms, `Esc` cancels                      |
| Delete selection | `Delete` or `Backspace`                                                     |
| Zoom             | Mouse wheel or pinch, anchored at the cursor (0.1×–4×)                      |
| Pan              | Middle-button drag, `Space` + drag, or drag empty canvas with Select active |
| Reset view       | `0`, or the **Reset view** button                                           |

## Architecture notes

- Block coordinates are stored in **world space**, never in screen pixels. The screen↔world conversion lives in pure, tested functions in [src/utils/coords.ts](src/utils/coords.ts).
- Pan and zoom are applied through the `<svg>` `viewBox`, not a CSS transform on the container, so world units stay the SVG user-space units.
- The Zustand store is the single source of truth. Every diagram mutation is a named store action, which is what lets Phase 4 wrap them in reversible commands.

## Status

In active development. Built in phases:

1. ✅ Project setup, SVG canvas with pan/zoom, block creation
2. ⬜ Drag-and-drop, multi-select, resizing
3. ⬜ Connections between blocks, snap-to-grid
4. ⬜ Undo/redo (command pattern), keyboard shortcuts
5. ⬜ Element styling, grouping
6. ⬜ PNG/SVG export, IndexedDB auto-save, dark/light themes
7. ⬜ Performance, Playwright E2E, deploy

Screenshots and a demo GIF land in Phase 7.

## License

[MIT](LICENSE)
