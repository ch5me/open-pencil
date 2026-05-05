import type { Env } from '../env'

export class AiProxyService {
  constructor(private env: Env) {}

  async chat(messages: Array<{ role: string; content: string }>, model?: string): Promise<Response> {
    const apiKey = this.env.ANTHROPIC_API_KEY ?? this.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('AI not configured')

    if (apiKey.startsWith('sk-ant-')) {
      return this.anthropicChat(apiKey, messages, model ?? 'claude-sonnet-4-20250514')
    }
    return this.openaiChat(apiKey, messages, model ?? 'gpt-4o')
  }

  private async anthropicChat(apiKey: string, messages: Array<{ role: string; content: string }>, model: string): Promise<Response> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 2048, messages }),
    })
    return response
  }

  private async openaiChat(apiKey: string, messages: Array<{ role: string; content: string }>, model: string): Promise<Response> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, messages }),
    })
    return response
  }

  async image(prompt: string, model?: string): Promise<Response> {
    const apiKey = this.env.OPENAI_API_KEY ?? this.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('AI not configured')

    if (apiKey.startsWith('sk-ant-')) {
      return this.anthropicImage(apiKey, prompt)
    }
    return this.openaiImage(apiKey, prompt, model ?? 'dall-e-3')
  }

  private async anthropicImage(_apiKey: string, prompt: string): Promise<Response> {
    return new Response(JSON.stringify({ error: 'Anthropic image not supported' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  private async openaiImage(apiKey: string, prompt: string, model: string): Promise<Response> {
    return fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
    })
  }
}