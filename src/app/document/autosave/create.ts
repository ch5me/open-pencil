import { watchDebounced } from '@vueuse/core'

import type { EditorState } from '@open-pencil/core/editor'

type AutosaveState = EditorState & { autosaveEnabled: boolean }

type AutosaveOptions = {
  state: AutosaveState
  getSavedVersion: () => number
  hasWritableSource: () => boolean
  saveCurrentDocument: () => Promise<void>
}

export function createAbortableSaveOperation() {
  let activeController: AbortController | null = null
  let tail: Promise<void> = Promise.resolve()

  function run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const result = tail.then(() => operation(controller.signal))
    tail = result.then(
      () => undefined,
      () => undefined
    )
    void result.then(
      () => {
        if (activeController === controller) activeController = null
        return undefined
      },
      () => {
        if (activeController === controller) activeController = null
        return undefined
      }
    )
    return result
  }

  function dispose() {
    activeController?.abort()
    activeController = null
  }

  return { run, dispose }
}

export function createAutosave({
  state,
  getSavedVersion,
  hasWritableSource,
  saveCurrentDocument
}: AutosaveOptions) {
  const stop = watchDebounced(
    () => state.sceneVersion,
    async (version) => {
      if (version === getSavedVersion()) return
      if (!state.autosaveEnabled) return
      if (!hasWritableSource()) return
      try {
        await saveCurrentDocument()
      } catch (e) {
        if (e instanceof Error && (e.name === 'IOCancelledError' || e.name === 'AbortError')) return
        console.warn('Autosave failed:', e)
      }
    },
    { debounce: 3000 }
  )

  return { disposeAutosave: stop }
}
