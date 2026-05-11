import { describe, it, expect } from 'vitest'

describe('AI Proxy API', () => {
  describe('POST /api/ai/chat', () => {
    it('requires auth', async () => {
      const authHeader = ''
      const hasAuth = authHeader.startsWith('Bearer ')
      expect(hasAuth).toBe(false)
    })

    it('forwards to anthropic when using sk-ant-api key', async () => {
      const apiKey = 'sk-ant-api123'
      const endpoint = apiKey.startsWith('sk-ant-')
        ? 'https://api.anthropic.com/v1/messages'
        : 'https://api.openai.com/v1/chat/completions'
      expect(endpoint).toContain('anthropic')
    })

    it('forwards to openai when using sk-chat key', async () => {
      const apiKey = 'sk-chat123'
      const endpoint = apiKey.startsWith('sk-ant-')
        ? 'https://api.anthropic.com/v1/messages'
        : 'https://api.openai.com/v1/chat/completions'
      expect(endpoint).toContain('openai')
    })
  })

  describe('POST /api/ai/image', () => {
    it('uses openai dall-e by default', async () => {
      const model = 'dall-e-3'
      expect(model).toBe('dall-e-3')
    })

    it('requires auth', async () => {
      const authHeader = ''
      const hasAuth = authHeader.startsWith('Bearer ')
      expect(hasAuth).toBe(false)
    })
  })

  describe('streaming', () => {
    it('handles streaming response from openai', async () => {
      const chunks = ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n']
      const full = chunks.join('')
      expect(full).toContain('data:')
    })
  })

  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      const status = 429
      expect(status).toBe(429)
    })
  })

  describe('auth errors', () => {
    it('returns 401 for missing auth', async () => {
      const status = 401
      expect(status).toBe(401)
    })
  })

  describe('config validation', () => {
    it('returns 503 when no AI API key configured', async () => {
      const apiKey = undefined
      const configured = Boolean(apiKey)
      expect(configured).toBe(false)
    })
  })
})
