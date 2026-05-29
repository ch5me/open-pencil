<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'
import { onMounted } from 'vue'

import { provideEditor, useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useAppTheme } from '@/app/shell/theme'
import { toast } from '@/app/shell/ui'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import AppToast from '@/components/AppToast.vue'

useHead({ titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil') })

const store = useEditorStore()
const { dialogs } = useI18n()
provideEditor(store)
useAppTheme()

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <RouterView />
    <AppToast />
  </TooltipProvider>
</template>
