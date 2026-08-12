/** Shared IndexedDB plumbing for the local canvas store and the sync outbox. */

export class IndexedDBOpenBlockedError extends Error {
  constructor(name: string) {
    super(`Opening ${name} remained blocked by another context`)
    this.name = 'IndexedDBOpenBlockedError'
  }
}

const BLOCKED_OPEN_TIMEOUT_MS = 250
const OPEN_ATTEMPTS = 2

function openIdbAttempt(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    let settled = false
    let blockedTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      if (blockedTimer != null) clearTimeout(blockedTimer)
      action()
    }
    req.onerror = () =>
      finish(() => reject(req.error ?? new Error(`Failed to open ${name}`)))
    req.onblocked = () => {
      if (blockedTimer != null) return
      blockedTimer = setTimeout(
        () => finish(() => reject(new IndexedDBOpenBlockedError(name))),
        BLOCKED_OPEN_TIMEOUT_MS
      )
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      if (settled) {
        db.close()
        return
      }
      finish(() => resolve(db))
    }
    req.onupgradeneeded = () => upgrade(req.result)
  })
}

export async function openIdb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new TypeError('IndexedDB is not available')
  }
  let lastError: unknown
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
    try {
      return await openIdbAttempt(name, version, upgrade)
    } catch (error) {
      lastError = error
      if (!(error instanceof IndexedDBOpenBlockedError) || attempt === OPEN_ATTEMPTS - 1) {
        throw error
      }
    }
  }
  throw lastError
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}
