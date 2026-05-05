<script setup lang="ts">
import { onMounted } from 'vue'
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'
import { useHostedSession } from '@/lib/auth/use-hosted-session'
import { useRouter } from 'vue-router'
import IconUser from '~icons/lucide/user'
import IconLogOut from '~icons/lucide/log-out'

provideCollabPanel()

const session = useHostedSession()
const router = useRouter()
onMounted(() => session.refresh())
</script>

<template>
  <div class="flex w-full items-center justify-end gap-2">
    <!-- Auth buttons (shown when signed out) -->
    <button
      v-if="!session.isSignedIn.value"
      data-test-id="collab-sign-in"
      class="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-panel px-3 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-surface"
      @click="router.push('/login')"
    >
      <IconUser class="size-3.5" />
      Sign in
    </button>

    <!-- User email (shown when signed in) -->
    <div
      v-else
      class="flex items-center gap-1.5"
    >
      <div class="flex size-6 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white">
        {{ session.user.value?.email?.[0]?.toUpperCase() ?? 'U' }}
      </div>
      <span class="max-w-24 truncate text-xs text-muted">{{ session.user.value?.email }}</span>
      <button
        data-test-id="collab-sign-out"
        class="flex size-5 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:text-surface"
        title="Sign out"
        @click="session.signOut()"
      >
        <IconLogOut class="size-3" />
      </button>
    </div>

    <div class="flex-1" />
    <CollabAvatarStack />
    <div class="flex-1" />
    <CollabSharePopover />
  </div>
</template>
