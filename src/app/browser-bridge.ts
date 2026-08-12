import type { ChatTransport, UIMessage } from 'ai'

import type { EditorStore } from '@/app/editor/session/create'
import type { PencilTestDriver } from '@/app/pencil/types'

export interface OpenPencilTestHooks {
  writeCount?: () => number
  mockHandle?: FileSystemFileHandle
  hostedAuthToken?: string
  hostedApiOrigin?: string
  forceHostedCollab?: boolean
  forceHostedAgent?: boolean
  savedOpen?: Window['open']
}

export interface OpenPencilWindowAPI {
  getStore?: () => EditorStore
  setChatTransport?: (factory: () => ChatTransport<UIMessage>) => void
  openFile?: (path: string) => Promise<void>
  pencilTestDriver?: PencilTestDriver
  test?: OpenPencilTestHooks
}

declare global {
  interface Window {
    openPencil?: OpenPencilWindowAPI
  }
}

let activeStore: EditorStore | null = null

function windowAPI(): OpenPencilWindowAPI {
  window.openPencil ??= {}
  window.openPencil.getStore ??= () => {
    if (!activeStore) throw new Error('OpenPencil store not initialized')
    return activeStore
  }
  return window.openPencil
}

export function setOpenPencilStore(store: EditorStore) {
  activeStore = store
  windowAPI()
}

export function setOpenPencilTestHooks(test: Partial<OpenPencilTestHooks>) {
  const api = windowAPI()
  api.test = { ...api.test, ...test }
}

export function exposeChatTransportOverride(
  setChatTransport: (factory: () => ChatTransport<UIMessage>) => void
) {
  windowAPI().setChatTransport = setChatTransport
}

export function setOpenPencilOpenFileHandler(openFile: (path: string) => Promise<void>) {
  windowAPI().openFile = openFile
}
