<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'

import { getHostedConfig, isHostedAuthEnabled } from '@/app/hosted/flags'
import { refreshSession, isAuthenticated } from '@/app/hosted/session'

useHead({ title: 'Authenticating — OpenPencil' })

const router = useRouter()
const route = useRoute()

const status = ref<'loading' | 'success' | 'error'>('loading')
const errorMessage = ref('')

onMounted(async () => {
  // If auth is not enabled, redirect to home
  if (!isHostedAuthEnabled()) {
    router.replace('/')
    return
  }

  const code = route.query.code as string | undefined
  const state = route.query.state as string | undefined

  if (!code) {
    status.value = 'error'
    errorMessage.value = 'Missing authentication code'
    return
  }

  try {
    const config = getHostedConfig()
    const apiOrigin = config.apiOrigin

    if (!apiOrigin) {
      throw new Error('API origin not configured')
    }

    // Exchange the authorization code for a session
    const response = await fetch(`${apiOrigin}/api/elf-auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        code,
        redirect_uri: config.authCallbackUrl
      })
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Authentication failed')
    }

    // Refresh the session to pick up the new cookie
    await refreshSession()

    if (isAuthenticated()) {
      status.value = 'success'
      // Redirect to home after a brief delay
      setTimeout(() => {
        router.replace('/')
      }, 1000)
    } else {
      throw new Error('Session not established after authentication')
    }
  } catch (error) {
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'Authentication failed'
    console.error('[Auth Callback]', error)
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background">
    <div class="w-full max-w-md space-y-8 rounded-xl border border-border bg-panel p-8 shadow-lg">
      <!-- Loading state -->
      <div v-if="status === 'loading'" class="text-center">
        <div class="mx-auto mb-4 size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <h1 class="text-xl font-semibold text-surface">Authenticating...</h1>
        <p class="mt-2 text-sm text-muted">Please wait while we verify your credentials</p>
      </div>

      <!-- Success state -->
      <div v-else-if="status === 'success'" class="text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-100">
          <icon-lucide-check class="size-6 text-green-600" />
        </div>
        <h1 class="text-xl font-semibold text-surface">Welcome!</h1>
        <p class="mt-2 text-sm text-muted">You have been authenticated successfully</p>
        <p class="mt-4 text-xs text-muted">Redirecting to editor...</p>
      </div>

      <!-- Error state -->
      <div v-else class="text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-100">
          <icon-lucide-alert-circle class="size-6 text-red-600" />
        </div>
        <h1 class="text-xl font-semibold text-surface">Authentication Failed</h1>
        <p class="mt-2 text-sm text-muted">{{ errorMessage }}</p>
        <button
          data-test-id="login-retry-button"
          class="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="router.replace('/login')"
        >
          Try Again
        </button>
      </div>
    </div>
  </div>
</template>
