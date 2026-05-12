<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useHostedSession } from '@/lib/auth/use-hosted-session'

const router = useRouter()
const session = useHostedSession()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSignIn() {
  error.value = ''
  loading.value = true
  try {
    await session.signIn(email.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface">
    <div class="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-panel p-8 shadow-lg">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-surface">Sign in</h1>
        <p class="mt-2 text-sm text-muted">Use your OpenPencil account</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSignIn">
        <div class="space-y-1.5">
          <label for="email" class="text-sm font-medium text-surface">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@example.com"
            class="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-surface placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div class="space-y-1.5">
          <label for="password" class="text-sm font-medium text-surface">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-surface placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {{ loading ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>

      <p class="text-center text-sm text-muted">
        Don't have an account?
        <router-link to="/signup" class="text-accent hover:underline">Sign up</router-link>
      </p>
    </div>
  </div>
</template>
