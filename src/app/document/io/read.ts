import type { Editor, EditorState } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'

import type { DocumentBackend } from '@/app/document/io/backend'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { readReloadSource } from '@/app/document/io/reload-source'
import { captureReloadState, restoreReloadState } from '@/app/document/io/reload-state'
import { toast } from '@/app/shell/ui'

type OpenDocumentState = EditorState & {
  documentName: string
  loading: boolean
}

type ReloadDocumentState = EditorState & { documentName: string }

type OpenFigFileOptions = {
  editor: Editor
  state: OpenDocumentState
  documentBackend: DocumentBackend
  setDocumentSource: (
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) => void
  fitCurrentPageToViewport: () => Promise<void>
}

type ReloadActionsOptions = {
  editor: Editor
  state: ReloadDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  setSavedVersion: (version: number) => void
}

export function createOpenActions({
  editor,
  state,
  documentBackend,
  setDocumentSource,
  fitCurrentPageToViewport
}: OpenFigFileOptions) {
  async function openFigFile(file: File, handle?: FileSystemFileHandle, path?: string) {
    try {
      state.loading = true
      const result = await documentBackend.open({ kind: 'file', file, handle, path })
      if (!result) return
      await applyImportedDocument(editor, result.graph)
      state.documentName = result.fileName.replace(/\.fig$/i, '')
      setDocumentSource(result.fileName, result.sourceFormat, result.handle, result.path)
      await fitCurrentPageToViewport()
      editor.requestRender()
    } catch (e) {
      console.error('Failed to open .fig file:', e)
      toast.error(`Failed to open file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      state.loading = false
    }
  }

  return { openFigFile }
}

export function createReloadActions({
  editor,
  state,
  getFilePath,
  getFileHandle,
  setSavedVersion
}: ReloadActionsOptions) {
  async function reloadFromDisk() {
    const snapshot = captureReloadState(state)
    const filePath = getFilePath()
    const fileHandle = getFileHandle()

    const imported = await readReloadSource({
      documentName: state.documentName,
      filePath,
      fileHandle
    })
    if (!imported) return
    const pageId = imported.getNode(snapshot.pageId) ? snapshot.pageId : imported.getPages()[0]?.id
    if (pageId) computeAllLayouts(imported, pageId)
    editor.replaceGraph(imported)

    editor.undo.clear()
    setSavedVersion(state.sceneVersion)
    restoreReloadState(editor, state, snapshot)
    editor.requestRender()
  }

  return { reloadFromDisk }
}
