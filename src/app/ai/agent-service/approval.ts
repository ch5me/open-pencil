export const DEFAULT_TOOL_APPROVAL_TIMEOUT_MS = 30_000

export interface ToolApprovalRequest {
  runId: string
  callId: string
  toolName: string
  input: Record<string, unknown>
}

export type ToolApprovalHandler = (request: ToolApprovalRequest) => boolean | Promise<boolean>

export async function requestToolApprovalFromUser(request: ToolApprovalRequest): Promise<boolean> {
  const { requestPermissionFromUser } = await import('@/app/ai/acp/permission')
  const response = await requestPermissionFromUser({
    requestId: request.callId,
    sessionId: request.runId,
    toolCall: { title: request.toolName, rawInput: request.input },
    options: [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' }
    ]
  })
  return response.outcome.optionId === 'allow-once'
}

/** A missing, failed, or slow approval is always a rejection. */
export async function requestBoundedToolApproval(
  handler: ToolApprovalHandler | undefined,
  request: ToolApprovalRequest,
  timeoutMs = DEFAULT_TOOL_APPROVAL_TIMEOUT_MS
): Promise<boolean> {
  if (!handler || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return false

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(handler(request)).catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
