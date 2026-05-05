import { useLocalStorage } from '@vueuse/core'

export interface AiProviderConfig {
  provider: 'openrouter' | 'openai' | 'anthropic' | 'google' | 'local'
  apiKey?: string
  baseUrl?: string
  model?: string
}

export const DEFAULT_AI_CONFIG: AiProviderConfig = {
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
}

const aiConfigRef = useLocalStorage<AiProviderConfig>('open-pencil:ai-provider-config', DEFAULT_AI_CONFIG)

export function loadAiConfig(): AiProviderConfig {
  return { ...aiConfigRef.value }
}

export function saveAiConfig(config: AiProviderConfig): void {
  aiConfigRef.value = config
}

export function isAiConfigured(config: AiProviderConfig): boolean {
  return Boolean(config.apiKey || config.provider === 'local')
}
