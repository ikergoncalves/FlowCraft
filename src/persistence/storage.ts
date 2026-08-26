/**
 * Where saved state goes, behind an interface small enough to fake.
 *
 * **Injectable, not because injection is tidy, but because jsdom has no
 * IndexedDB.** The alternative was `fake-indexeddb`, a polyfill several times
 * the size of everything in this directory, installed so that unit tests could
 * exercise a browser API that the browser harness already exercises for real.
 * Three keys of async get/put/delete is the entire surface this app needs from
 * IndexedDB, so the seam goes there: the serialising, validating, migrating
 * and debouncing — all of the logic — is tested against an in-memory driver,
 * and IndexedDB itself is verified in Chrome by `verify-browser.mjs`, which is
 * the only place a real one exists anyway.
 *
 * Every method is async, including the memory driver's. A synchronous fake
 * would let tests pass that deadlock on a real store.
 */
export interface StorageDriver {
  /** Named for diagnostics and for the status line's "in memory" case. */
  readonly name: string
  /** The stored value, or `undefined` when the key has never been written. */
  read(key: string): Promise<unknown>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/**
 * A driver backed by a plain `Map`.
 *
 * Values are deep-copied on the way in and out, because IndexedDB structured-
 * clones them and a fake that handed back live references would hide the class
 * of bug where a save captures an object the editor goes on mutating.
 */
export function memoryDriver(seed: Record<string, unknown> = {}): StorageDriver {
  const entries = new Map<string, unknown>(
    Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]),
  )

  return {
    name: 'memory',
    read: (key) => Promise.resolve(structuredClone(entries.get(key))),
    write: (key, value) => {
      entries.set(key, structuredClone(value))
      return Promise.resolve()
    },
    remove: (key) => {
      entries.delete(key)
      return Promise.resolve()
    },
  }
}

export const DATABASE_NAME = 'flowcraft'
export const STORE_NAME = 'state'
const DATABASE_VERSION = 1

/**
 * How long to wait for `indexedDB.open` before giving up on it.
 *
 * `open` neither resolves nor rejects when another tab holds the database open
 * across a version change: it fires `blocked` and then waits, possibly for as
 * long as that tab is up. An editor that hung on a blank canvas waiting for
 * something the user cannot see would be worse than one that quietly ran
 * without saving, so the wait is bounded.
 */
const OPEN_TIMEOUT_MS = 3000

interface IndexedDbOptions {
  factory?: IDBFactory
  databaseName?: string
  timeoutMs?: number
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => {
      resolve(source.result)
    }
    source.onerror = () => {
      reject(source.error ?? new Error('IndexedDB request failed'))
    }
  })
}

/**
 * Opens the database and returns a driver over it.
 *
 * Rejects — rather than falling back on its own — when IndexedDB is missing,
 * refused (private browsing on some platforms) or blocked. Choosing what to do
 * about that is the caller's business, and the caller is the one that can tell
 * the user.
 */
export async function openIndexedDbDriver({
  factory = globalThis.indexedDB,
  databaseName = DATABASE_NAME,
  timeoutMs = OPEN_TIMEOUT_MS,
}: IndexedDbOptions = {}): Promise<StorageDriver> {
  if (!factory) throw new Error('This browser has no IndexedDB')

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error('Timed out opening IndexedDB'))
      })
    }, timeoutMs)

    let open: IDBOpenDBRequest
    try {
      open = factory.open(databaseName, DATABASE_VERSION)
    } catch (error) {
      finish(() => {
        reject(error instanceof Error ? error : new Error(String(error)))
      })
      return
    }

    open.onupgradeneeded = () => {
      // One object store with string keys, which is all a key/value shim
      // needs. No indexes: nothing ever queries this by anything but the key.
      if (!open.result.objectStoreNames.contains(STORE_NAME)) {
        open.result.createObjectStore(STORE_NAME)
      }
    }
    open.onblocked = () => {
      finish(() => {
        reject(new Error('IndexedDB is blocked by another tab'))
      })
    }
    open.onsuccess = () => {
      finish(() => {
        resolve(open.result)
      })
    }
    open.onerror = () => {
      finish(() => {
        reject(open.error ?? new Error('Could not open IndexedDB'))
      })
    }
  })

  const run = <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const transaction = database.transaction(STORE_NAME, mode)
    const result = request(body(transaction.objectStore(STORE_NAME)))
    return new Promise<T>((resolve, reject) => {
      // The request settling is not the write landing: a quota failure shows
      // up on the *transaction*, after a `put` has already reported success.
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
      }
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction failed'))
      }
      if (mode === 'readonly') {
        result.then(resolve, reject)
        return
      }
      transaction.oncomplete = () => {
        result.then(resolve, reject)
      }
    })
  }

  return {
    name: 'indexeddb',
    read: (key) => run('readonly', (store) => store.get(key) as IDBRequest<unknown>),
    write: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key))
    },
    remove: async (key) => {
      await run('readwrite', (store) => store.delete(key))
    },
  }
}
