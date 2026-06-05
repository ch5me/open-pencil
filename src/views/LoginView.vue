<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { getHostedConfig, isHostedAuthEnabled } from '@/app/hosted/flags'
import { isAuthenticated, refreshSession } from '@/app/hosted/session'

useHead({ title: 'Sign In — OpenPencil' })

const router = useRouter()

onMounted(async () => {
  // If auth is not enabled, redirect to home
  if (!isHostedAuthEnabled()) {
    router.replace('/')
    return
  }

  // Check if already authenticated
  await refreshSession()
  if (isAuthenticated()) {
    router.replace('/')
  }
})

function signInWithElf() {
  const config = getHostedConfig()
  const apiOrigin = config.apiOrigin
  const callbackUrl = config.authCallbackUrl

  if (!apiOrigin || !callbackUrl) {
    console.error('[Auth] Missing API origin or callback URL')
    return
  }

  // Redirect to ELF auth provider
  // The API handles the OAuth flow and redirects back to the callback URL
  const authUrl = new URL('/api/elf-auth/authorize', apiOrigin)
  authUrl.searchParams.set('redirect_uri', callbackUrl)
  authUrl.searchParams.set('response_type', 'code')
  window.location.href = authUrl.toString()
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background">
    <div class="w-full max-w-md space-y-8 rounded-xl border border-border bg-panel p-8 shadow-lg">
      <!-- Logo and title -->
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          <img src="/favicon-128.png" alt="OpenPencil" class="size-10" />
        </div>
        <h1 class="text-2xl font-bold text-surface">Welcome to OpenPencil</h1>
        <p class="mt-2 text-sm text-muted">Sign in to access the hosted design editor</p>
      </div>

      <!-- Sign in button -->
      <button
        data-test-id="login-elf-button"
        class="flex w-full items-center justify-center gap-3 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        @click="signInWithElf"
      >
        <icon-lucide-log-in class="size-4" />
        Sign in with ELF
      </button>

      <!-- Info text -->
      <div class="rounded-lg bg-muted/50 p-4">
        <p class="text-xs text-muted">
          OpenPencil uses ELF authentication to sync your designs across devices. 
          Your files are stored securely and accessible only to you.
        </p>
      </div>

      <!-- Footer -->
      <div class="text-center">
        <p class="text-xs text-muted">
          <a href="https://openpencil.dev" target="_blank" rel="noopener" class="underline hover:text-surface">
            Learn more about OpenPencil
          </a>
        </p>
      </div>
    </div>
  </div>
</template>
