/**
 * A minimal Chrome DevTools Protocol harness.
 *
 * Phase 3 measured the drag threshold's cursor lag by driving a real Chrome
 * over CDP, because jsdom implements no layout, no hit testing and no pointer
 * capture — the three things a gesture regression actually shows up in. That
 * script lived in a temp directory and had to be rewritten from memory every
 * time. This is the same capability, kept in the repository.
 *
 * It is deliberately *not* a test framework. Playwright arrives in Phase 7;
 * until then this is a few hundred lines with no dependencies beyond Node 24's
 * global `WebSocket` and Vite's own Node API, so that "did that gesture
 * regress in a real renderer?" is one `npm run verify:browser` away.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where Chrome usually is, per platform. `CHROME_PATH` overrides all of it. */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((path) => typeof path === 'string' && path.length > 0)

export function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `Chrome not found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to override.`,
    )
  }
  return found
}

export const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Waits for a predicate, polling. Used instead of a flat sleep wherever the
 * thing being waited for has an observable signal — a fixed sleep is how these
 * harnesses become flaky.
 */
async function waitFor(
  predicate,
  { timeout = 15000, interval = 50, what = 'condition' },
) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await sleep(interval)
  }
}

/** A CDP session over one page target. */
class CdpSession {
  #socket
  #nextId = 1
  #pending = new Map()
  #listeners = new Map()

  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.#pending.get(message.id)
        if (!entry) return
        this.#pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      for (const handler of this.#listeners.get(message.method) ?? []) {
        handler(message.params)
      }
    })
  }

  static async connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => {
        reject(new Error('CDP websocket failed to open'))
      })
    })
    return new CdpSession(socket)
  }

  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? []
    handlers.push(handler)
    this.#listeners.set(method, handlers)
  }

  close() {
    this.#socket.close()
  }

  /**
   * Evaluates an expression in the page and returns its value by value.
   *
   * `returnByValue` keeps the harness free of remote object handles; every
   * probe here reads primitives or small plain objects out of the DOM.
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(
        `Page threw: ${result.exceptionDetails.exception?.description ?? 'unknown'}`,
      )
    }
    return result.result.value
  }

  /** Waits two animation frames, so React has painted whatever just changed. */
  settle() {
    return this.evaluate(`
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => { resolve(true) }))
      })
    `)
  }
}

/** Chrome modifier bitmask, as CDP defines it. */
export const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

/**
 * Enough of a key table for the shortcuts this harness exercises.
 *
 * Chrome needs the virtual key code and `code` to be right, not just `key`:
 * a keydown missing them reaches the page with an empty `code`, which any
 * handler keyed on physical layout would ignore.
 */
const KEYS = {
  a: { key: 'a', code: 'KeyA', vk: 65, text: 'a' },
  g: { key: 'g', code: 'KeyG', vk: 71, text: 'g' },
  r: { key: 'r', code: 'KeyR', vk: 82, text: 'r' },
  v: { key: 'v', code: 'KeyV', vk: 86, text: 'v' },
  z: { key: 'z', code: 'KeyZ', vk: 90, text: 'z' },
  y: { key: 'y', code: 'KeyY', vk: 89, text: 'y' },
  d: { key: 'd', code: 'KeyD', vk: 68, text: 'd' },
  c: { key: 'c', code: 'KeyC', vk: 67, text: 'c' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
}

export class Page {
  constructor(session) {
    this.session = session
  }

  evaluate(expression) {
    return this.session.evaluate(expression)
  }

  settle() {
    return this.session.settle()
  }

  /**
   * Resizes the viewport the page believes it has.
   *
   * `Emulation.setDeviceMetricsOverride` rather than a new Chrome with a
   * different `--window-size`: the override re-evaluates media queries and
   * re-lays-out in place, so one session can measure the same DOM at 1280px
   * and at 400px. `deviceScaleFactor: 0` means "leave it as the platform has
   * it", which keeps client pixels equal to CSS pixels and the coordinates
   * every other probe in this file uses unchanged.
   */
  async resize(width, height) {
    await this.session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await this.settle()
  }

  /** Hands the viewport back to the real window. */
  async resetSize() {
    await this.session.send('Emulation.clearDeviceMetricsOverride')
    await this.settle()
  }

  /**
   * Presses and releases one key.
   *
   * Modified keys are sent as `rawKeyDown` with no `text`: Chrome only
   * produces a character for an unmodified key, and sending `text` alongside
   * Ctrl makes the event look like typing.
   */
  async press(name, modifiers = 0) {
    const spec = KEYS[name]
    if (!spec) throw new Error(`Unknown key: ${name}`)
    const shifted = (modifiers & MODIFIER.shift) !== 0
    const base = {
      modifiers,
      key: shifted && spec.text ? spec.key.toUpperCase() : spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
    }
    const plain = modifiers === 0 || modifiers === MODIFIER.shift

    await this.session.send('Input.dispatchKeyEvent', {
      ...base,
      type: plain && spec.text ? 'keyDown' : 'rawKeyDown',
      ...(plain && spec.text
        ? { text: shifted ? spec.text.toUpperCase() : spec.text }
        : {}),
    })
    await this.session.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
    await this.settle()
  }

  mouse(type, { x, y, button = 'left', buttons = 0, modifiers = 0, clickCount }) {
    return this.session.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button,
      buttons,
      modifiers,
      clickCount:
        clickCount ?? (type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0),
      pointerType: 'mouse',
    })
  }

  async click(x, y, modifiers = 0) {
    await this.mouse('mousePressed', { x, y, buttons: 1, modifiers })
    await this.mouse('mouseReleased', { x, y, buttons: 0, modifiers })
    await this.settle()
  }

  /**
   * A real double-click.
   *
   * Chrome synthesises `dblclick` from the `clickCount` on the *second* press,
   * so both presses have to be dispatched with the count Chrome expects — a
   * pair of ordinary clicks produces no `dblclick` at all.
   */
  async doubleClick(x, y, modifiers = 0) {
    await this.mouse('mousePressed', { x, y, buttons: 1, modifiers, clickCount: 1 })
    await this.mouse('mouseReleased', { x, y, buttons: 0, modifiers, clickCount: 1 })
    await this.mouse('mousePressed', { x, y, buttons: 1, modifiers, clickCount: 2 })
    await this.mouse('mouseReleased', { x, y, buttons: 0, modifiers, clickCount: 2 })
    await this.settle()
  }

  /**
   * A press-move-release drag, moved in steps.
   *
   * Real drags arrive as many small moves, and the number of steps is exactly
   * what a per-frame accumulation bug is sensitive to: a gesture that
   * integrates deltas instead of working from a snapshot drifts with the step
   * count, so a one-jump drag would hide it.
   */
  async drag(from, to, { steps = 12, modifiers = 0 } = {}) {
    await this.mouse('mousePressed', { ...from, buttons: 1, modifiers })
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps
      await this.mouse('mouseMoved', {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        buttons: 1,
        modifiers,
      })
    }
    await this.mouse('mouseReleased', { ...to, buttons: 0, modifiers })
    await this.settle()
  }
}

/**
 * Boots a Vite dev server plus a headless Chrome pointed at it, hands both to
 * `run`, and tears everything down afterwards.
 *
 * The dev server comes from Vite's Node API rather than a spawned `npm run
 * dev`, which on Windows means no shell, no PATH resolution and no orphaned
 * child process to reap.
 */
export async function withBrowser(run) {
  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    ),
    server: { port: 0, strictPort: false },
    logLevel: 'error',
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('Vite did not report a local URL')

  const profile = await mkdtemp(join(tmpdir(), 'flowcraft-cdp-'))
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-renderer-backgrounding',
      '--hide-scrollbars',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let session
  try {
    // Chrome writes the port it actually took into the profile directory.
    const port = await waitFor(
      async () => {
        try {
          const contents = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
          const first = contents.split('\n')[0]?.trim()
          return first && first !== '0' ? Number(first) : null
        } catch {
          return null
        }
      },
      { what: 'Chrome to publish its DevTools port' },
    )

    const target = await waitFor(
      async () => {
        const response = await fetch(
          `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
          { method: 'PUT' },
        )
        return response.ok ? await response.json() : null
      },
      { what: 'a CDP page target' },
    )

    session = await CdpSession.connect(target.webSocketDebuggerUrl)
    await session.send('Page.enable')
    await session.send('Runtime.enable')
    await session.send('Page.bringToFront').catch(() => {})

    const page = new Page(session)
    // The app is a single mounted React tree; waiting on the canvas is a
    // stronger signal than the load event, which fires before hydration.
    await waitFor(
      () => page.evaluate(`return !!document.querySelector('[data-testid="canvas"]')`),
      {
        what: 'the canvas to mount',
      },
    )

    return await run(page)
  } finally {
    session?.close()
    chrome.kill()
    await server.close()
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

/** A tiny assertion tally, so the script can report every check it ran. */
export function createChecklist() {
  const failures = []
  let passed = 0

  const record = (ok, name, detail) => {
    if (ok) {
      passed += 1
      console.log(`  \u2713 ${name}`)
    } else {
      failures.push(`${name} — ${detail}`)
      console.log(`  \u2717 ${name} — ${detail}`)
    }
    return ok
  }

  return {
    ok: (name, condition, detail = 'expected true') =>
      record(Boolean(condition), name, detail),
    close: (name, actual, expected, tolerance = 0.5) =>
      record(
        typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
        name,
        `expected ${expected} \u00b1 ${tolerance}, got ${actual}`,
      ),
    equal: (name, actual, expected) =>
      record(
        actual === expected,
        name,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ),
    summary: () => ({ passed, failures }),
  }
}
