import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { API_BASE_URL } from '@/lib/auth/authTransport'

import type { AIProviderID } from '@open-pencil/core/constants'
import type { LanguageModel } from 'ai'

export type ModelConfig = {
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
}

export function createLanguageModel(config: ModelConfig): LanguageModel {
  const needsCustomModel =
    config.providerID === 'openai-compatible' || config.providerID === 'anthropic-compatible'
  const effectiveModelID = needsCustomModel ? config.customModelID : config.modelID

  switch (config.providerID) {
    case 'openrouter': {
      const openrouter = createOpenRouter({
        apiKey: config.apiKey,
        headers: {
          'X-OpenRouter-Title': 'OpenPencil',
          'HTTP-Referer': 'https://github.com/open-pencil/open-pencil'
        }
      })
      return openrouter(effectiveModelID)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.apiKey })
      return anthropic(effectiveModelID)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.apiKey })
      return openai(effectiveModelID)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
      return google(effectiveModelID)
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: config.apiKey })
      return deepseek(effectiveModelID)
    }
    case 'zai': {
      const zai = createAnthropic({
        apiKey: config.apiKey,
        baseURL: 'https://api.z.ai/api/anthropic'
      })
      return zai(effectiveModelID)
    }
    case 'minimax': {
      const minimax = createOpenAI({
        apiKey: config.apiKey,
        baseURL: 'https://api.minimax.io/v1'
      })
      return minimax.chat(effectiveModelID)
    }
    case 'openpencil': {
      const baseUrl = `${API_BASE_URL}/api/ai`
      const sessionToken = getSessionToken()
      const headers: Record<string, string> = {}
      if (sessionToken) headers['authorization'] = `Bearer ${sessionToken}`
      if (config.modelID.startsWith('anthropic/')) {
        const anthropic = createAnthropic({
          apiKey: config.apiKey || 'hosted',
          baseURL: baseUrl,
          headers,
        })
        return anthropic(effectiveModelID)
      } else {
        const openai = createOpenAI({
          apiKey: config.apiKey || 'hosted',
          baseURL: baseUrl,
          headers,
        })
        return openai.chat(effectiveModelID)
      }
    }
    case 'openai-compatible': {
      const custom = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.customBaseURL
      })
      return config.customAPIType === 'responses'
        ? custom.responses(effectiveModelID)
        : custom.chat(effectiveModelID)
    }
    case 'anthropic-compatible': {
      const custom = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.customBaseURL
      })
      return custom(effectiveModelID)
    }
    default: {
      if (config.providerID.startsWith('acp:')) {
        throw new Error('ACP providers do not use direct API models')
      }
      throw new Error(`Unknown provider: ${config.providerID}`)
    }
  }
}

function getSessionToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )__Secure-better-auth\.session_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}
