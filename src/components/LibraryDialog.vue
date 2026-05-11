<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'

import IconCloud from '~icons/lucide/cloud'
import IconFile from '~icons/lucide/file'
import IconFilePlus from '~icons/lucide/file-plus'
import IconFolderOpen from '~icons/lucide/folder-open'
import IconLoader from '~icons/lucide/loader'
import IconX from '~icons/lucide/x'

import { useI18n } from '@open-pencil/vue'
import { useCloudDocuments } from '@/app/shell/menu/library'
import { openFileDialog } from '@/app/shell/menu/files'
import { useDialogUI } from '@/components/ui/dialog'
import { createTab } from '@/app/tabs'
const open = defineModel<boolean>('open', { default: false })

useI18n()
const cls = useDialogUI({ content: 'flex w-[640px] max-w-[90vw] flex-col' })
const { documents, loading, error, isSignedIn, fetchDocuments, openCloudDocument } =
  useCloudDocuments()

watch(open, (isOpen) => {
  if (isOpen) {
    void fetchDocuments()
  }
})

const openingId = ref<string | null>(null)

async function handleOpenCloud(docId: string) {
  openingId.value = docId
  try {
    await openCloudDocument(docId)
    open.value = false
  } finally {
    openingId.value = null
  }
}

async function handleOpenLocal() {
  open.value = false
  await openFileDialog()
}

function handleNew() {
  open.value = false
  createTab()
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="cls.overlay" />
      <DialogContent data-test-id="library-dialog" :class="cls.content">
        <!-- Header -->
        <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div class="flex items-center gap-2">
            <IconCloud class="size-4 text-muted" />
            <DialogTitle class="text-sm font-semibold text-surface">Open Document</DialogTitle>
          </div>
          <DialogClose
            class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
          >
            <IconX class="size-4" />
          </DialogClose>
        </div>

        <!-- Body -->
        <div class="flex flex-1 overflow-hidden">
          <!-- Cloud documents panel -->
          <div class="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-border">
            <div class="shrink-0 border-b border-border px-4 py-2">
              <p class="text-xs text-muted">Cloud Documents</p>
            </div>

            <!-- Loading -->
            <div v-if="loading" class="flex flex-1 items-center justify-center py-12">
              <IconLoader class="size-5 animate-spin text-muted" />
            </div>

            <!-- Error -->
            <div
              v-else-if="error"
              class="flex flex-1 flex-col items-center justify-center gap-2 py-12"
            >
              <p class="text-xs text-muted">{{ error }}</p>
              <button
                class="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-hover hover:text-surface"
                @click="() => fetchDocuments()"
              >
                Retry
              </button>
            </div>

            <!-- Not signed in -->
            <div
              v-else-if="!isSignedIn"
              class="flex flex-1 flex-col items-center justify-center gap-3 py-12"
            >
              <IconCloud class="size-8 text-muted opacity-50" />
              <p class="text-xs text-muted">Sign in to see your cloud documents</p>
              <a
                href="/login"
                class="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
              >
                Sign in
              </a>
            </div>

            <!-- Empty -->
            <div
              v-else-if="documents.length === 0"
              class="flex flex-1 flex-col items-center justify-center gap-3 py-12"
            >
              <IconFile class="size-8 text-muted opacity-50" />
              <p class="text-xs text-muted">No cloud documents yet</p>
              <button
                class="rounded border border-border px-3 py-1.5 text-xs text-surface hover:bg-hover"
                @click="handleNew"
              >
                Create new
              </button>
            </div>

            <!-- Document list -->
            <div v-else class="flex flex-col divide-y divide-border">
              <button
                v-for="doc in documents"
                :key="doc.id"
                :disabled="openingId !== null"
                class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-50"
                :class="openingId === doc.id ? 'bg-hover' : ''"
                @click="handleOpenCloud(doc.id)"
              >
                <IconFile class="size-4 shrink-0 text-muted" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs text-surface">{{ doc.title || 'Untitled' }}</p>
                  <p class="text-[11px] text-muted">{{ relativeTime(doc.updatedAt) }}</p>
                </div>
                <IconLoader v-if="openingId === doc.id" class="size-3 animate-spin text-muted" />
              </button>
            </div>
          </div>

          <!-- Actions sidebar -->
          <div class="flex w-44 shrink-0 flex-col gap-2 p-3">
            <button
              class="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-xs text-surface transition-colors hover:bg-hover"
              @click="handleOpenLocal"
            >
              <IconFolderOpen class="size-3.5 text-muted" />
              Open local file
            </button>
            <button
              class="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-xs text-surface transition-colors hover:bg-hover"
              @click="handleNew"
            >
              <IconFilePlus class="size-3.5 text-muted" />
              New document
            </button>
          </div>
        </div>

        <DialogDescription class="sr-only">
          Browse cloud documents or open a local file
        </DialogDescription>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
