<script setup lang="ts">
import { onMounted } from 'vue'
import CollabAuthPopover from '@/components/CollabPanel/CollabAuthPopover.vue'
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'
import { useHostedSession } from '@/lib/auth/use-hosted-session'

provideCollabPanel()

const session = useHostedSession()
onMounted(() => session.refresh())
</script>

<template>
  <div class="flex w-full items-center justify-end gap-2">
    <CollabAuthPopover />

    <div class="flex-1" />
    <CollabAvatarStack />
    <div class="flex-1" />
    <CollabSharePopover />
  </div>
</template>
