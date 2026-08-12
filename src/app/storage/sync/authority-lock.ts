const fallbackTails = new Map<string, Promise<void>>()

async function withFallbackLock<T>(canvasId: string, action: () => Promise<T>): Promise<T> {
  const previous = fallbackTails.get(canvasId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  fallbackTails.set(canvasId, current)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (fallbackTails.get(canvasId) === current) fallbackTails.delete(canvasId)
  }
}

/** Serialize remote effects per canvas across tabs/workers; native falls back in-process. */
export async function withCanvasSyncAuthority<T>(
  canvasId: string,
  action: () => Promise<T>
): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(`open-pencil:storage-sync:${canvasId}`, action)
  }
  return withFallbackLock(canvasId, action)
}
