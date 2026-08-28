# Deploying FlowCraft

FlowCraft is a static single-page app with no backend, no environment
variables and no secrets. `npm run build` produces a `dist/` directory that any
static host can serve.

## Vercel

`vercel.json` in the repository root is the whole configuration:

- **`rewrites`** send every unmatched path to `index.html`. Vercel serves
  static files before applying rewrites, so this does not shadow `/assets/…`;
  what it fixes is a refresh or a shared link on any path but `/`, which would
  otherwise land on Vercel's own 404 page. The app has no router today, so this
  is insurance rather than a requirement — but it is the kind of insurance that
  costs three lines and is discovered by a user rather than by a test.
- **Cache headers.** Vite fingerprints every asset filename, so `/assets/*` is
  immutable for a year; `index.html` is the one file whose name never changes,
  so it must revalidate or a deploy would never reach anyone.

Nothing else is needed. There is no `installCommand` override, no output
directory guessing, and no framework preset to fight: the build is `tsc -b &&
vite build` and the output is `dist`.

```bash
npx vercel login          # opens a browser; one time per machine
npx vercel link           # associates this directory with a Vercel project
npx vercel --prod         # builds and deploys
```

The first `vercel link` asks which scope and project to use; answering the
prompts creates `.vercel/` locally, which is git-ignored.

## Confirming the deployment actually works

Building and uploading is not the same as working. Four things the editor
depends on are invisible on `localhost` and can be taken away by a host:

- **A secure context.** `IndexedDB` and `createImageBitmap` are gated on it.
  `localhost` is always secure; a plain-HTTP deployment is not.
- **A Content-Security-Policy** permissive enough for the `blob:` URLs the PNG
  rasteriser builds and the `data:` URL it loads the SVG through.
- **Correct MIME types** for the ES modules, or nothing loads at all.
- **History fallback**, as above.

The smoke spec checks all four against a live URL, and fails on any console
error or page error along the way:

```bash
E2E_BASE_URL=https://your-deployment.vercel.app npx playwright test smoke
```

That is the check that turns "it deployed" into "it works". Run it before
putting the URL in the README.

## Any other static host

Serve `dist/` over HTTPS with unknown paths rewritten to `index.html`. Netlify,
Cloudflare Pages, GitHub Pages and `npx serve` all work; only the rewrite rule
changes shape.
