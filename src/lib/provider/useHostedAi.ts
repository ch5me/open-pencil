import { useLocalStorage } from '@vueuse/core'
import { computed, readonly, ref } from 'vue'

import type { AiProviderConfig } from './aiProviderConfig'

const storedConfig = useLocalStorage<AiProviderConfig>('open-pencil:ai-provider-config', {
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4'
})
const storedHostedApiKey = useLocalStorage('open-pencil:hosted-ai-api-key', '')
const config = ref<AiProviderConfig>({ ...storedConfig.value })
const apiKey = ref(storedHostedApiKey.value)
let initialized = false

export function useHostedAi() {
  function init() {
    if (initialized) return
    config.value = { ...storedConfig.value }
    apiKey.value = storedHostedApiKey.value || storedConfig.value.apiKey || ''
    initialized = true
  }

  const isConfigured = computed(() => Boolean(apiKey.value || config.value.provider === 'local'))

  async function sendMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<Response> {
    const key = apiKey.value || storedHostedApiKey.value || ''
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    }

    if (config.value.provider === 'anthropic') {
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['authorization'] = `Bearer ${key}`
    }

    const body: Record<string, unknown> = {
      model: config.value.model ?? 'claude-sonnet-4-20250514',
      messages
    }

    if (config.value.provider === 'anthropic') {
      body.max_tokens = 1024
    }

    let endpoint = 'https://api.openai.com/v1/chat/completions'
    if (config.value.provider === 'anthropic') {
      endpoint = 'https://api.anthropic.com/v1/messages'
    } else if (config.value.provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions'
    } else if (config.value.baseUrl) {
      endpoint = `${config.value.baseUrl}/chat/completions`
    }

    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  }

  function setConfig(newConfig: AiProviderConfig) {
    config.value = newConfig
    apiKey.value = newConfig.apiKey ?? ''
    storedConfig.value = newConfig
    storedHostedApiKey.value = apiKey.value
  }

  return {
    config: readonly(config),
    apiKey: readonly(apiKey),
    isConfigured,
    init,
    sendMessage,
    setConfig
  }
}
