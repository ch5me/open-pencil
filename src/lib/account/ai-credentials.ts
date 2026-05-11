import { apiRequest } from '@/lib/auth/authTransport'

export interface AccountAiCredentialStatus {
  user: {
    email: string
    isCh5Managed: boolean
  }
  managed: {
    openrouter: boolean
    scenario: boolean
  }
  saved: {
    openrouter: boolean
    scenario: boolean
  }
}

export async function getAccountAiCredentialStatus(): Promise<AccountAiCredentialStatus> {
  return apiRequest<AccountAiCredentialStatus>('/api/account/ai-credentials')
}

export async function updateAccountAiCredentials(body: {
  openrouter?: string | null
  scenario?: string | null
}): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/account/ai-credentials', {
    method: 'PUT',
    body
  })
}
