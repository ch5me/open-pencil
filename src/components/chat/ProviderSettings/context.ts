import { computed, inject, provide, proxyRefs, ref, watch } from 'vue'

import { useAIChat } from '@/app/ai/chat/use'
import { useHostedSession } from '@/lib/auth/use-hosted-session'
import {
  getAccountAiCredentialStatus,
  updateAccountAiCredentials,
  type AccountAiCredentialStatus,
} from '@/lib/account/ai-credentials'

import type { InjectionKey, ShallowUnwrapRef } from 'vue'

function createProviderSettingsContext() {
  const {
    providerID,
    providerDef,
    apiKey,
    setAPIKey,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsApiKey,
    unsplashAccessKey
  } = useAIChat()
  const hostedSession = useHostedSession()

  const isACP = computed(() => providerID.value.startsWith('acp:'))
  const keyInput = ref('')
  const pexelsKeyInput = ref('')
  const unsplashKeyInput = ref('')
  const baseURLInput = ref(customBaseURL.value)
  const customModelInput = ref(customModelID.value)
  const hasExistingKey = ref(!!apiKey.value)
  const hasExistingPexelsKey = ref(!!pexelsApiKey.value)
  const hasExistingUnsplashKey = ref(!!unsplashAccessKey.value)
  const accountStatus = ref<AccountAiCredentialStatus | null>(null)
  const accountStatusError = ref<string | null>(null)
  const openRouterAccountKeyInput = ref('')
  const scenarioAccountKeyInput = ref('')
  const savingAccountKeys = ref(false)

  watch(providerID, () => {
    keyInput.value = ''
    hasExistingKey.value = !!apiKey.value
    baseURLInput.value = customBaseURL.value
    customModelInput.value = customModelID.value
  })

  async function refreshAccountStatus() {
    if (!hostedSession.isSignedIn.value) {
      accountStatus.value = null
      accountStatusError.value = null
      return
    }

    try {
      accountStatus.value = await getAccountAiCredentialStatus()
      accountStatusError.value = null
    } catch (error) {
      accountStatusError.value = error instanceof Error ? error.message : String(error)
    }
  }

  void refreshAccountStatus()

  watch(
    () => hostedSession.isSignedIn.value,
    () => {
      void refreshAccountStatus()
    },
    { immediate: true }
  )

  async function save() {
    if (keyInput.value.trim()) {
      setAPIKey(keyInput.value.trim())
      hasExistingKey.value = true
      keyInput.value = ''
    }
    if (pexelsKeyInput.value.trim()) {
      pexelsApiKey.value = pexelsKeyInput.value.trim()
      hasExistingPexelsKey.value = true
      pexelsKeyInput.value = ''
    }
    if (unsplashKeyInput.value.trim()) {
      unsplashAccessKey.value = unsplashKeyInput.value.trim()
      hasExistingUnsplashKey.value = true
      unsplashKeyInput.value = ''
    }
    if (providerDef.value.supportsCustomBaseURL) {
      customBaseURL.value = baseURLInput.value.trim()
    }
    if (providerDef.value.supportsCustomModel) {
      customModelID.value = customModelInput.value.trim()
    }

    if (!hostedSession.isSignedIn.value) return
    if (!openRouterAccountKeyInput.value.trim() && !scenarioAccountKeyInput.value.trim()) return

    savingAccountKeys.value = true
    try {
      await updateAccountAiCredentials({
        ...(openRouterAccountKeyInput.value.trim()
          ? { openrouter: openRouterAccountKeyInput.value.trim() }
          : {}),
        ...(scenarioAccountKeyInput.value.trim()
          ? { scenario: scenarioAccountKeyInput.value.trim() }
          : {}),
      })
      openRouterAccountKeyInput.value = ''
      scenarioAccountKeyInput.value = ''
      await refreshAccountStatus()
    } finally {
      savingAccountKeys.value = false
    }
  }

  function clearKey() {
    setAPIKey('')
    keyInput.value = ''
    hasExistingKey.value = false
  }

  function clearPexelsKey() {
    pexelsApiKey.value = ''
    pexelsKeyInput.value = ''
    hasExistingPexelsKey.value = false
  }

  function clearUnsplashKey() {
    unsplashAccessKey.value = ''
    unsplashKeyInput.value = ''
    hasExistingUnsplashKey.value = false
  }

  function setCustomAPIType(value: string) {
    customAPIType.value = value as 'completions' | 'responses'
    void save()
  }

  async function clearSavedAccountKey(provider: 'openrouter' | 'scenario') {
    if (!hostedSession.isSignedIn.value) return
    savingAccountKeys.value = true
    try {
      await updateAccountAiCredentials({ [provider]: null })
      await refreshAccountStatus()
    } finally {
      savingAccountKeys.value = false
    }
  }

  return {
    providerID,
    providerDef,
    apiKey,
    customAPIType,
    customBaseURL,
    customModelID,
    maxOutputTokens,
    pexelsApiKey,
    unsplashAccessKey,
    isACP,
    keyInput,
    pexelsKeyInput,
    unsplashKeyInput,
    baseURLInput,
    customModelInput,
    hasExistingKey,
    hasExistingPexelsKey,
    hasExistingUnsplashKey,
    hostedSession,
    accountStatus,
    accountStatusError,
    openRouterAccountKeyInput,
    scenarioAccountKeyInput,
    savingAccountKeys,
    save,
    clearKey,
    clearPexelsKey,
    clearUnsplashKey,
    clearSavedAccountKey,
    refreshAccountStatus,
    setCustomAPIType
  }
}

export type ProviderSettingsContext = ShallowUnwrapRef<
  ReturnType<typeof createProviderSettingsContext>
>

const PROVIDER_SETTINGS_KEY: InjectionKey<ProviderSettingsContext> =
  Symbol('ProviderSettingsContext')

export function provideProviderSettings() {
  const ctx = proxyRefs(createProviderSettingsContext())
  provide(PROVIDER_SETTINGS_KEY, ctx)
  return ctx
}

export function useProviderSettingsContext(): ProviderSettingsContext {
  const ctx = inject(PROVIDER_SETTINGS_KEY)
  if (!ctx) throw new Error('Provider settings controls must be used within ProviderSettings')
  return ctx
}
