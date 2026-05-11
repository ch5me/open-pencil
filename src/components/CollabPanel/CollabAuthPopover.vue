<script setup lang="ts">
import { computed, ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import IconLogOut from '~icons/lucide/log-out'
import IconUser from '~icons/lucide/user'
import IconUserPlus from '~icons/lucide/user-plus'

import { useHostedSession } from '@/lib/auth/use-hosted-session'
import { usePopoverUI } from '@/components/ui/popover'

const session = useHostedSession()
const cls = usePopoverUI({ content: 'z-50 w-80 p-4' })
const open = ref(false)
const mode = ref<'signin' | 'signup'>('signin')

const signInEmail = ref('')
const signInPassword = ref('')
const signUpName = ref('')
const signUpEmail = ref('')
const signUpPassword = ref('')
const formError = ref('')

const isSignedIn = computed(() => session.isSignedIn.value)
const userEmail = computed(() => session.user.value?.email ?? '')
const userInitial = computed(() => userEmail.value[0]?.toUpperCase() ?? 'G')

async function handleSignIn() {
  formError.value = ''
  try {
    await session.signIn(signInEmail.value, signInPassword.value)
    open.value = false
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

async function handleSignUp() {
  formError.value = ''
  try {
    await session.signUp(signUpEmail.value, signUpPassword.value, signUpName.value || undefined)
    open.value = false
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

async function handleSignOut() {
  formError.value = ''
  try {
    await session.signOut()
    open.value = false
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        data-test-id="collab-auth-trigger"
        class="flex h-7 cursor-pointer items-center gap-2 rounded-md border border-border bg-panel px-2.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-surface"
      >
        <div
          class="flex size-6 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-white"
        >
          {{ userInitial }}
        </div>
        <span class="max-w-28 truncate">
          {{ isSignedIn ? userEmail : 'Guest' }}
        </span>
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent :class="cls.content" :side-offset="8" side="bottom" align="end">
        <template v-if="isSignedIn">
          <div class="space-y-3">
            <div>
              <p class="text-sm font-medium text-surface">Signed in</p>
              <p class="mt-1 text-xs text-muted">{{ userEmail }}</p>
            </div>
            <button
              data-test-id="collab-inline-sign-out"
              class="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-surface"
              @click="handleSignOut"
            >
              <IconLogOut class="size-4" />
              Sign out
            </button>
          </div>
        </template>

        <template v-else>
          <div class="space-y-4">
            <div>
              <p class="text-sm font-medium text-surface">Account</p>
              <p class="mt-1 text-xs text-muted">
                Sign in or create an account without leaving the editor.
              </p>
            </div>

            <div class="flex gap-2 rounded-md bg-surface p-1">
              <button
                class="flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors"
                :class="
                  mode === 'signin' ? 'bg-accent text-white' : 'text-muted hover:text-surface'
                "
                @click="mode = 'signin'"
              >
                Sign in
              </button>
              <button
                class="flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors"
                :class="
                  mode === 'signup' ? 'bg-accent text-white' : 'text-muted hover:text-surface'
                "
                @click="mode = 'signup'"
              >
                Create account
              </button>
            </div>

            <form v-if="mode === 'signin'" class="space-y-3" @submit.prevent="handleSignIn">
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-surface">Email</label>
                <input
                  v-model="signInEmail"
                  type="email"
                  required
                  autocomplete="email"
                  class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-surface outline-none focus:border-accent"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-surface">Password</label>
                <input
                  v-model="signInPassword"
                  type="password"
                  required
                  autocomplete="current-password"
                  class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-surface outline-none focus:border-accent"
                />
              </div>
              <p v-if="formError" class="text-xs text-red-500">{{ formError }}</p>
              <button
                class="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
                :disabled="session.loading.value"
              >
                <IconUser class="size-4" />
                {{ session.loading.value ? 'Signing in…' : 'Sign in' }}
              </button>
            </form>

            <form v-else class="space-y-3" @submit.prevent="handleSignUp">
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-surface">Name</label>
                <input
                  v-model="signUpName"
                  type="text"
                  autocomplete="name"
                  class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-surface outline-none focus:border-accent"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-surface">Email</label>
                <input
                  v-model="signUpEmail"
                  type="email"
                  required
                  autocomplete="email"
                  class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-surface outline-none focus:border-accent"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-surface">Password</label>
                <input
                  v-model="signUpPassword"
                  type="password"
                  required
                  autocomplete="new-password"
                  class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-surface outline-none focus:border-accent"
                />
              </div>
              <p v-if="formError" class="text-xs text-red-500">{{ formError }}</p>
              <button
                class="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90"
                :disabled="session.loading.value"
              >
                <IconUserPlus class="size-4" />
                {{ session.loading.value ? 'Creating account…' : 'Create account' }}
              </button>
            </form>
          </div>
        </template>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
