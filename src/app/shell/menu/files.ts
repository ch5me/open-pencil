import { useFileDialog } from '@vueuse/core'

import { openLibraryDialog } from '@/app/shell/menu/library-state'
import { openFileInNewTab } from '@/app/tabs'
import { IS_BROWSER, IS_TAURI } from '@/constants'

const fileDialog = useFileDialog({ accept: '.fig,.pen', multiple: false, reset: true })

fileDialog.onChange((files) => {
  const file = files?.[0]
  if (file) void openFileInNewTab(file)
})

if (IS_BROWSER) {
  ;(
    window as Window & { __OPEN_PENCIL_OPEN_FILE__?: (path: string) => Promise<void> }
  ).__OPEN_PENCIL_OPEN_FILE__ = async (path: string) => {
    const response = await fetch(path)
    const blob = await response.blob()
    const name = path.split('/').pop() ?? 'file.fig'
    const file = new File([blob], name, { type: 'application/octet-stream' })
    await openFileInNewTab(file, undefined, path)
  }
}

export async function openFileFromPath(path: string) {
  if (!IS_TAURI) return
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const bytes = await readFile(path)
  const file = new File([bytes], path.split('/').pop() ?? 'file.fig')
  await openFileInNewTab(file, undefined, path)
}

export async function openFileDialog() {
  if (IS_TAURI) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({
      filters: [{ name: 'Design file', extensions: ['fig', 'pen'] }],
      multiple: false
    })
    if (!path) return
    await openFileFromPath(path)
    return
  }

  openLibraryDialog()
}

export async function importFileDialog() {
  await openFileDialog()
}
