<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useHostedSession } from '@/lib/auth/use-hosted-session'

const router = useRouter()
const session = useHostedSession()

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSignUp() {
  error.value = ''
  loading.value = true
  try {
    await session.signUp(email.value, password.value, name.value || undefined)
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
        <h1 class="text-2xl font-bold text-surface">Create account</h1>
        <p class="mt-2 text-sm text-muted">Start using OpenPencil for free</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSignUp">
        <div class="space-y-1.5">
          <label for="name" class="text-sm font-medium text-surface">Name (optional)</label>
          <input
            id="name"
            v-model="name"
            type="text"
            autocomplete="name"
            placeholder="Your name"
            class="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-surface placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

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
            autocomplete="new-password"
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
          {{ loading ? 'Creating account...' : 'Create account' }}
        </button>
      </form>

      <p class="text-center text-sm text-muted">
        Already have an account?
        <router-link to="/login" class="text-accent hover:underline">Sign in</router-link>
      </p>
    </div>
  </div>
</template>
