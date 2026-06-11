import { expect, test } from '@playwright/test'

import { useEditorSetup } from '#tests/e2e/fixtures'

type MockWritable = { write(): Promise<void>; close(): Promise<void> }
type MockFileHandle = { name: string; createWritable(): Promise<MockWritable> }

type TestWindow = Omit<Window, 'showSaveFilePicker'> & {
  showSaveFilePicker?: (options?: unknown) => Promise<MockFileHandle>
  openPencil?: {
    test?: Record<string, unknown> & { writeCount?: () => number }
    getStore?: () => { state: { autosaveEnabled: boolean } }
  }
}

const editor = useEditorSetup()

test('local backend save and autosave use File System Access handle', async () => {
  await editor.page.evaluate(() => {
    let writes = 0
    const mockWritable: MockWritable = {
      write: async () => {
        writes++
      },
      close: async () => undefined
    }
    const mockHandle: MockFileHandle = {
      name: 'backend-evidence.fig',
      createWritable: async () => mockWritable
    }
    const testWindow = window as TestWindow
    testWindow.openPencil ??= {}
    testWindow.openPencil.test = { ...testWindow.openPencil.test, writeCount: () => writes }
    testWindow.showSaveFilePicker = async () => mockHandle
  })

  await editor.canvas.drawRect(300, 260, 96, 72)
  await editor.page.keyboard.press('Meta+Shift+s')
  await expect
    .poll(() =>
      editor.page.evaluate(() => (window as TestWindow).openPencil?.test?.writeCount?.() ?? 0)
    )
    .toBeGreaterThan(0)

  await editor.page.evaluate(() => {
    const store = (window as TestWindow).openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.state.autosaveEnabled = true
  })
  await editor.canvas.drawRect(430, 260, 80, 64)
  await expect
    .poll(
      () =>
        editor.page.evaluate(() => (window as TestWindow).openPencil?.test?.writeCount?.() ?? 0),
      { timeout: 6000 }
    )
    .toBeGreaterThan(1)

  await editor.page.screenshot({ path: '.sisyphus/evidence/task-3-document-backend.png' })
})
