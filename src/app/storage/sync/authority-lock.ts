export class StorageSyncAuthorityUnsupportedError extends Error {
  constructor(message = 'Cross-context storage sync authority is unavailable') {
    super(message)
    this.name = 'StorageSyncAuthorityUnsupportedError'
  }
}

function canvasAuthorityName(canvasId: string): string {
  return `open-pencil:storage:${canvasId}`
}

type AuthorityOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function requestCanvasAuthority<T>(
  canvasId: string,
  action: () => Promise<T>
): Promise<AuthorityOutcome<T>> {
  return navigator.locks.request(canvasAuthorityName(canvasId), async () => {
    try {
      return { ok: true, value: await action() }
    } catch (error) {
      return { ok: false, error }
    }
  })
}

/** Serialize remote effects per canvas across tabs/workers or fail before any remote effect. */
export async function withCanvasSyncAuthority<T>(
  canvasId: string,
  action: () => Promise<T>
): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    throw new StorageSyncAuthorityUnsupportedError()
  }
  let outcome: AuthorityOutcome<T>
  try {
    outcome = await requestCanvasAuthority(canvasId, action)
  } catch (error) {
    if (error instanceof StorageSyncAuthorityUnsupportedError) throw error
    if (error instanceof Error && error.name !== 'NotSupportedError') throw error
    throw new StorageSyncAuthorityUnsupportedError(
      error instanceof Error ? `Storage sync authority rejected: ${error.message}` : undefined
    )
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

/** Join remote-effect ordering when Web Locks work; local durability remains available without it. */
export async function withCanvasMutationAuthority<T>(
  canvasId: string,
  action: () => Promise<T>
): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return action()
  let outcome: AuthorityOutcome<T>
  try {
    outcome = await requestCanvasAuthority(canvasId, action)
  } catch (error) {
    if (error instanceof Error && error.name === 'NotSupportedError') return action()
    throw error
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
