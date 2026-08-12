<script setup lang="ts">
import { useElementVisibility, useObjectUrl } from '@vueuse/core'
import { computed, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import { EXPORT_IMAGE_TIMEOUT_MS } from '@/app/document/export/files'
import { useEditorStore } from '@/app/editor/active-store'
import { findAssetPage } from '@/components/assets-panel/page'
import { ASSET_GRID_THUMBNAIL_SIZE, ASSET_THUMBNAIL_RENDER_SCALE } from '@/constants'

const { nodeId, alt, size } = defineProps<{
  nodeId: string
  alt: string
  size: number
}>()

const editor = useEditorStore()
const isGridThumbnail = computed(() => size === ASSET_GRID_THUMBNAIL_SIZE)
const thumbnail = useTemplateRef<HTMLElement>('thumbnail')
const isVisible = useElementVisibility(thumbnail)
const previewBlob = shallowRef<Blob | null>(null)
const previewURL = useObjectUrl(previewBlob)
let requestId = 0
let previewController: AbortController | null = null

async function updatePreview() {
  previewController?.abort()
  const controller = new AbortController()
  previewController = controller
  const currentRequest = ++requestId
  const node = editor.graph.getNode(nodeId)
  if (!node) {
    previewController = null
    previewBlob.value = null
    return
  }

  const maxDimension = Math.max(node.width, node.height, 1)
  const scale = (size * ASSET_THUMBNAIL_RENDER_SCALE) / maxDimension
  try {
    const data = await editor.renderExportImage(
      [nodeId],
      scale,
      'PNG',
      findAssetPage(node, editor.graph)?.id ?? editor.state.currentPageId,
      AbortSignal.any([controller.signal, AbortSignal.timeout(EXPORT_IMAGE_TIMEOUT_MS)])
    )
    if (currentRequest !== requestId) return
    previewBlob.value = data ? new Blob([data], { type: 'image/png' }) : null
  } catch {
    if (currentRequest === requestId) previewBlob.value = null
  } finally {
    if (previewController === controller) previewController = null
  }
}

watch(
  () => [nodeId, size, editor.state.sceneVersion, isVisible.value],
  ([, , , visible]) => {
    if (visible) void updatePreview()
  },
  { immediate: true, flush: 'post' }
)
onUnmounted(() => previewController?.abort())
</script>

<template>
  <div
    ref="thumbnail"
    data-slot="asset-thumbnail"
    :class="[
      'flex shrink-0 items-center justify-center overflow-hidden rounded bg-canvas/60',
      isGridThumbnail ? 'size-24' : 'size-10'
    ]"
  >
    <img
      v-if="previewURL"
      :src="previewURL"
      :alt="alt"
      class="max-h-full max-w-full object-contain"
      draggable="false"
    />
    <icon-lucide-component v-else class="size-4 text-component" aria-hidden="true" />
  </div>
</template>
