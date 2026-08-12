import { FigmaAPI } from '@open-pencil/core/figma-api'

import { EXPORT_IMAGE_TIMEOUT_MS } from '@/app/document/export/files'
import type { EditorStore } from '@/app/editor/active-store'
import { listFamilies, listFonts } from '@/app/editor/fonts'

export function makeFigmaFromStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): FigmaAPI {
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const api = new FigmaAPI(store.graph)
  api.setRenderer(store.renderer ?? null)
  api.currentPage = api.wrapNode(pageId)
  api.currentPage.selection = [...store.state.selectedIds]
    .map((id) => api.getNodeById(id))
    .filter((n): n is NonNullable<typeof n> => n !== null)
  api.viewport = {
    center: {
      x: (-store.state.panX + viewportWidth / 2) / store.state.zoom,
      y: (-store.state.panY + viewportHeight / 2) / store.state.zoom
    },
    zoom: store.state.zoom
  }
  api.exportImage = (nodeIds, opts) =>
    store.renderExportImage(
      nodeIds,
      opts.scale ?? 1,
      opts.format ?? 'PNG',
      undefined,
      AbortSignal.timeout(EXPORT_IMAGE_TIMEOUT_MS)
    )
  api.listAvailableFontsAsync = async () => {
    const [systemFonts, familyOptions] = await Promise.all([listFonts(), listFamilies()])
    const fonts = systemFonts.flatMap(({ family, styles }) =>
      styles.map((style) => ({ fontName: { family, style } }))
    )
    const seenFamilies = new Set(systemFonts.map(({ family }) => family))
    for (const { family } of familyOptions) {
      if (!seenFamilies.has(family)) fonts.push({ fontName: { family, style: 'Regular' } })
    }
    return fonts
  }
  return api
}
