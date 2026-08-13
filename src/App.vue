<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'
import { onMounted } from 'vue'

import { provideEditor, useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useAppTheme } from '@/app/shell/theme'
import { toast } from '@/app/shell/ui'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { kickSyncEngine } from '@/app/storage/sync'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import AppToast from '@/components/Shell/AppToast.vue'

const store = useEditorStore()
const { dialogs, locale } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil'),
  htmlAttrs: { lang: locale }
})

provideEditor(store)
useAppTheme()

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
  void kickSyncEngine()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <RouterView />
    <SettingsDialog />
    <AppToast />
  </TooltipProvider>
</template>
