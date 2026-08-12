import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'

import { getAutomationAuthToken } from '@/app/automation/mcp/spawn'

export interface ProductPermissionOption {
  optionId: string
  kind: string
  name: string
}

export interface ProductPermissionRequest {
  requestId?: string
  sessionId: string
  options: ProductPermissionOption[]
  toolCall?: unknown
}

export interface OpenPencilMCPServer {
  type: 'http'
  name: 'open-pencil'
  url: string
  headers: Array<{ name: string; value: string }>
}

export function buildOpenPencilMCPServers(
  automationAuthToken: string | null
): OpenPencilMCPServer[] {
  return [
    {
      type: 'http',
      name: 'open-pencil',
      url: `http://127.0.0.1:${AUTOMATION_HTTP_PORT}/mcp`,
      headers: automationAuthToken
        ? [{ name: 'Authorization', value: `Bearer ${automationAuthToken}` }]
        : []
    }
  ]
}

export async function getOpenPencilMCPServers(): Promise<OpenPencilMCPServer[]> {
  return buildOpenPencilMCPServers(await getAutomationAuthToken())
}
