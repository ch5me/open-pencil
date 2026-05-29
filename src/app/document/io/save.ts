import type { DocumentBackend } from '@/app/document/io/backend'

type SaveActionsOptions = {
  buildFigFile: () => Uint8Array | Promise<Uint8Array>
  documentBackend: DocumentBackend
}

export function createSaveActions({ buildFigFile, documentBackend }: SaveActionsOptions) {
  async function saveFigFile() {
    await documentBackend.save(await buildFigFile())
  }

  async function saveFigFileAs() {
    await documentBackend.saveAs(await buildFigFile())
  }

  return { saveFigFile, saveFigFileAs }
}
