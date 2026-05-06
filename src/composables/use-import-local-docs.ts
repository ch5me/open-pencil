import { ref } from 'vue'
import { LocalDocImporter } from '../lib/persistence/LocalDocImporter'
import { LocalDocumentAdapter } from '../lib/persistence/DocumentPersistenceAdapter'

export function useImportLocalDocs() {
  const importing = ref(false)
  const progress = ref(0)
  const errors = ref<string[]>([])

  async function importLocalDocs(apiBase: string, _userId: string): Promise<string[]> {
    importing.value = true
    progress.value = 0
    errors.value = []

    const localAdapter = new LocalDocumentAdapter()
    const importer = new LocalDocImporter(localAdapter)

    const localDocs = await importer.detectLocalDocs()
    const imported: string[] = []

    for (let i = 0; i < localDocs.length; i++) {
      const doc = localDocs[i]
      try {
        const hostedId = await importer.importDoc(doc.id, apiBase)
        imported.push(hostedId)
      } catch (err) {
        errors.value.push(`Failed to import "${doc.title}": ${String(err)}`)
      }
      progress.value = Math.round(((i + 1) / localDocs.length) * 100)
    }

    importing.value = false
    return imported
  }

  return { importing, progress, errors, importLocalDocs }
}
